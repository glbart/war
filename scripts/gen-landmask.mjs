// Запуск: npm run gen:landmask
// Классифицируем океан по доминированию синего на Blue Marble (тот же URL, что в assets/config.ts).
// jpeg-js — чистый JS-декодер (без нативных зависимостей); fetch глобальный в Node ≥18.
import { writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';

const SRC = 'https://unpkg.com/three-globe@2.31.0/example/img/earth-blue-marble.jpg';
const W = 512,
  H = 256;

const buf = new Uint8Array(await (await fetch(SRC)).arrayBuffer());
const img = jpeg.decode(buf, { useTArray: true }); // { width, height, data: RGBA }

const bitset = new Uint8Array(Math.ceil((W * H) / 8));
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const sx = Math.floor((x / W) * img.width);
    const sy = Math.floor((y / H) * img.height);
    const o = (sy * img.width + sx) * 4;
    const r = img.data[o],
      g = img.data[o + 1],
      b = img.data[o + 2];
    // Океан: синий заметно доминирует над красным и зелёным (в т.ч. в тёмных зонах глубокого
    // океана, где абсолютная яркость мала — поэтому порог не завязан на яркость).
    const isOcean = b > r + 8 && b > g + 3;
    if (!isOcean) {
      const idx = y * W + x;
      bitset[idx >> 3] |= 1 << (idx & 7);
    }
  }
}
const b64 = Buffer.from(bitset).toString('base64');
writeFileSync(
  'src/sim/landmask.data.ts',
  `// АВТОГЕНЕРАЦИЯ scripts/gen-landmask.mjs — не править вручную.\n` +
    `export const LANDMASK_W = ${W};\nexport const LANDMASK_H = ${H};\n` +
    `export const LANDMASK_BITS_B64 = '${b64}';\n`,
);
console.log('landmask.data.ts записан:', bitset.length, 'байт');
