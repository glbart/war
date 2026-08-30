#!/usr/bin/env node
// Запуск: npm run gen:countries
// Печёт растр политических границ мира в src/sim/countries.data.ts — тем же способом, что и
// landmask (скачали реальные данные → растеризовали → положили сжатым base64 в репозиторий,
// чтобы в рантайме не было ни сети, ни зависимостей).
//
// Источник: Natural Earth Admin 0 (масштаб 1:110m) — общественное достояние, ~177 стран.
// Точность нам не нужна: важно, чтобы каждая представленная в игре страна имела узнаваемую
// территорию и границы.
import { writeFileSync } from 'node:fs';

const SRC =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const W = 1024,
  H = 512;
const NONE = 255; // «не суша / нет страны»

const geo = await (await fetch(SRC)).json();
const features = geo.features.filter((f) => f.geometry);
if (features.length > 254)
  throw new Error(`стран больше, чем помещается в байт: ${features.length}`);

// У Natural Earth ISO_A3 местами стоит '-99' (Франция, Норвегия, Косово…) — тогда берём
// ADM0_A3, иначе половина Европы осталась бы без кода.
const isoOf = (p) => {
  const a = p.ISO_A3;
  if (typeof a === 'string' && /^[A-Z]{3}$/.test(a)) return a;
  const b = p.ADM0_A3;
  return typeof b === 'string' && /^[A-Z]{3}$/.test(b) ? b : '???';
};
const iso = features.map((f) => isoOf(f.properties));
const names = features.map((f) => f.properties.ADMIN ?? f.properties.NAME ?? '?');

// Пиксельные координаты: equirect, та же конвенция, что у landmask (v = 0 на северном полюсе).
const px = (lon) => ((lon + 180) / 360) * W;
const py = (lat) => ((90 - lat) / 180) * H;

const raster = new Uint8Array(W * H).fill(NONE);

// Скан-лайн заливка по правилу «чёт-нечет» сразу по ВСЕМ кольцам страны: дырки (анклавы)
// получаются автоматически, отдельной обработки не требуют.
function fillCountry(index, polygons) {
  const edges = [];
  let minY = H,
    maxY = 0;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[i + 1];
        const y1 = py(lat1),
          y2 = py(lat2);
        if (y1 === y2) continue;
        edges.push({ x1: px(lon1), y1, x2: px(lon2), y2 });
        minY = Math.min(minY, y1, y2);
        maxY = Math.max(maxY, y1, y2);
      }
    }
  }
  const from = Math.max(0, Math.floor(minY));
  const to = Math.min(H - 1, Math.ceil(maxY));
  for (let y = from; y <= to; y++) {
    const cy = y + 0.5;
    const xs = [];
    for (const e of edges) {
      const lo = Math.min(e.y1, e.y2),
        hi = Math.max(e.y1, e.y2);
      if (cy < lo || cy >= hi) continue;
      xs.push(e.x1 + ((cy - e.y1) / (e.y2 - e.y1)) * (e.x2 - e.x1));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const sx = Math.max(0, Math.round(xs[i]));
      const ex = Math.min(W - 1, Math.round(xs[i + 1]) - 1);
      for (let x = sx; x <= ex; x++) raster[y * W + x] = index;
    }
  }
}

features.forEach((f, i) => {
  const g = f.geometry;
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  fillCountry(i, polygons);
});

// RLE: страны — это длинные однородные прогоны, поэтому растр сжимается в десятки раз.
const runs = [];
let value = raster[0],
  length = 0;
for (let i = 0; i < raster.length; i++) {
  if (raster[i] === value && length < 65535) {
    length++;
    continue;
  }
  runs.push([value, length]);
  value = raster[i];
  length = 1;
}
runs.push([value, length]);

const bytes = new Uint8Array(runs.length * 3);
runs.forEach(([v, len], i) => {
  bytes[i * 3] = v;
  bytes[i * 3 + 1] = (len >> 8) & 0xff;
  bytes[i * 3 + 2] = len & 0xff;
});
const b64 = Buffer.from(bytes).toString('base64');

const filled = raster.reduce((n, v) => n + (v !== NONE ? 1 : 0), 0);
const ts = `// АВТОГЕНЕРАЦИЯ scripts/gen-countries.mjs — не править вручную.
// Источник: Natural Earth Admin 0 1:110m (общественное достояние).
// Растр ${W}×${H}, RLE (значение, длина big-endian uint16), ${NONE} — не суша.
export const COUNTRIES_W = ${W};
export const COUNTRIES_H = ${H};
export const COUNTRIES_NONE = ${NONE};
export const COUNTRY_ISO: readonly string[] = ${JSON.stringify(iso)};
export const COUNTRY_NAMES: readonly string[] = ${JSON.stringify(names)};
export const COUNTRIES_RLE_B64 =
  '${b64}';
`;
writeFileSync(new URL('../src/sim/countries.data.ts', import.meta.url), ts);
console.log(
  `после перегенерации прогони: npx prettier --write src/sim/countries.data.ts\n` +
    `стран: ${features.length}, прогонов: ${runs.length}, суши: ${((filled / raster.length) * 100).toFixed(1)}%, base64: ${(b64.length / 1024).toFixed(0)} КБ`,
);
