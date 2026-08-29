#!/usr/bin/env node
// Массовые прогоны партий для балансировки слоя решений (спека 2026-08-29-utility-ai §7).
// Симуляция детерминирована и не зависит от DOM, поэтому её можно гонять пачками в Node.
//
// Запуск: npm run balance -- [партий] [доктрина] [предел секунд] [сценарий]
//   npm run balance                      # 50 партий кампании: игрок НИЧЕГО не делает
//   npm run balance -- 30 restrained 900 war   # партия начинается с залпа США по России
//
// Сценарий idle (по умолчанию) — базовая линия режима «Нераспространение»: если бездействие
// выигрывает, играть незачем.
//
// Выводит распределение исходов, среднюю длительность партии, средние потери и активность
// дипломатии — то, по чему видно, не скатился ли ИИ в «все молчат» или «все всегда стреляют».
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = Number(process.argv[2] ?? 50);
const DOCTRINE = process.argv[3] ?? 'restrained';
const TIME_LIMIT = Number(process.argv[4] ?? 1200);
const SCENARIO = process.argv[5] ?? 'idle';

// Грузим TS-модули симуляции через vite (тот же резолвинг, что у приложения и тестов).
const server = await createServer({
  root: REPO_ROOT,
  server: { middlewareMode: true },
  appType: 'custom',
});
const { Simulation } = await server.ssrLoadModule('/src/sim/Simulation.ts');
const { TICK_DT } = await server.ssrLoadModule('/src/core/time.ts');

const outcomes = new Map();
let totalTime = 0;
let totalDeaths = 0;
let totalLaunched = 0;
let totalIntercepted = 0;
let totalTruces = 0;
let unfinished = 0;
let totalArmed = 0;
let totalStopped = 0;

for (let seed = 1; seed <= GAMES; seed++) {
  const sim = new Simulation(seed);
  let t = 0;
  let truces = 0;
  let done = null;
  let cmds = [
    { kind: 'setDoctrine', doctrine: DOCTRINE },
    { kind: 'setSide', faction: 'usa' },
    ...(SCENARIO === 'war' ? [{ kind: 'salvo', from: 'usa', to: 'russia' }] : []),
  ];
  while (t < TIME_LIMIT && done === null) {
    for (const e of sim.step(TICK_DT, cmds)) {
      if (e.kind === 'ceasefireAccepted') truces++;
      if (e.kind === 'gameOver') done = e;
    }
    cmds = [];
    t += TICK_DT;
  }
  if (done === null) {
    unfinished++;
    continue;
  }
  outcomes.set(done.outcome, (outcomes.get(done.outcome) ?? 0) + 1);
  totalTime += t;
  totalTruces += truces;
  totalArmed += done.campaign.armed.length;
  totalStopped += done.campaign.stopped;
  for (const row of done.summary) {
    totalDeaths += row.popTotal - row.popAlive;
    totalLaunched += row.launched;
    totalIntercepted += row.intercepted;
  }
}

const finished = GAMES - unfinished;
console.log(
  `\nПартий: ${GAMES} · доктрина: ${DOCTRINE} · лимит: ${TIME_LIMIT} с · сценарий: ${SCENARIO}`,
);
console.log('--- исходы ---');
for (const [outcome, count] of [...outcomes].sort((a, b) => b[1] - a[1])) {
  console.log(
    `  ${outcome.padEnd(10)} ${String(count).padStart(4)}  ${((count / GAMES) * 100).toFixed(0)}%`,
  );
}
if (unfinished > 0)
  console.log(`  не завершились ${unfinished} (${((unfinished / GAMES) * 100).toFixed(0)}%)`);
if (finished > 0) {
  console.log('--- в среднем на партию ---');
  console.log(`  длительность      ${(totalTime / finished).toFixed(0)} с`);
  console.log(`  погибло           ${(totalDeaths / finished).toFixed(1)} млн`);
  console.log(`  пущено боеголовок ${(totalLaunched / finished).toFixed(1)}`);
  console.log(`  сбито ПРО         ${(totalIntercepted / finished).toFixed(1)}`);
  console.log(`  перемирий         ${(totalTruces / finished).toFixed(1)}`);
  console.log(
    `  новых ядерных держав ${(totalArmed / finished).toFixed(2)} (остановлено ${(totalStopped / finished).toFixed(2)})`,
  );
}
await server.close();
