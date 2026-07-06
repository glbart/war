#!/usr/bin/env node
// Headless-приёмка (Task 12): поднимает dev-сервер и headless Chrome (swiftshader), бьёт
// __strike по суше/воде/льду через dev-хуки (src/debug/devHooks.ts, доступны только в
// import.meta.env.DEV — см. src/main.ts), сохраняет скриншоты и падает (exit 1), если в
// консоли браузера обнаружены ошибки компиляции шейдеров/исключения/INVALID_ENUM.
//
// Запуск: npm run accept
// Сам поднимает `npm run dev` на порту DEV_PORT и гасит его по завершении — второй
// параллельный dev-сервер не нужен. Путь к Chrome — CHROME_BIN, дефолт см. ниже.
//
// Основа — самодельный CDP-клиент на fetch/WebSocket (без puppeteer), перенесён и
// консолидирован из временных scratchpad-харнессов приёмки Task 9-11.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const CHROME_BIN =
  process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = 9333;
const DEV_PORT = 5173;
const DEV_URL = `http://localhost:${DEV_PORT}/`;
const OUT_DIR = path.join(REPO_ROOT, '.accept-shots'); // gitignored — скриншоты не коммитим
const USER_DATA_DIR = path.join(OUT_DIR, 'chrome-profile');

// Записи консоли, которые считаем ожидаемым шумом (не проваливают приёмку):
// - фолбэк WebGPU→WebGL2 (закономерен под swiftshader/headless без GPU-адаптера);
// - перф-сообщения GL-драйвера про ReadPixels-стоны (не ошибки рендера);
// - служебные логи vite HMR и favicon 404 (браузер сам запрашивает /favicon.ico).
const BENIGN_PATTERNS = [
  /No available adapters/i,
  /WebGPU is not available, running under WebGL2/i,
  /GPU stall due to ReadPixels/i,
  /\[vite\]/i,
  /favicon\.ico/i,
];

mkdirSync(OUT_DIR, { recursive: true });

const consoleLog = [];
function logConsole(entry) {
  consoleLog.push(entry);
  console.log('[console]', JSON.stringify(entry));
}

function isBad(entry) {
  const text = entry.text || '';
  if (BENIGN_PATTERNS.some((re) => re.test(text))) return false;
  if (entry.type === 'exception') return true;
  if (entry.level === 'error') return true;
  return /INVALID_ENUM|SHADER|shader.*(error|compil)|GL_INVALID/i.test(text);
}

async function waitForHttp(url, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return; // dev-сервер поднялся (404 — тоже ответ сервера)
    } catch {
      // ещё не поднялся
    }
    await sleep(200);
  }
  throw new Error(`Сервис не ответил вовремя: ${url}`);
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.eventHandlers = [];
    this.ready = new Promise((resolve) => {
      this.ws.addEventListener('open', () => resolve());
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.eventHandlers) h(msg.method, msg.params);
      }
    });
  }
  onEvent(handler) {
    this.eventHandlers.push(handler);
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }
  close() {
    this.ws.close();
  }
}

function fmtRemote(obj) {
  if (!obj) return '';
  if (obj.value !== undefined) return String(obj.value);
  if (obj.description) return obj.description;
  return JSON.stringify(obj);
}

async function getPageTarget(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await res.json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('page target не найден: ' + JSON.stringify(list));
  return page;
}

async function main() {
  console.log('Поднимаю dev-сервер (npm run dev)...');
  const devProc = spawn('npm', ['run', 'dev', '--', '--port', String(DEV_PORT), '--strictPort'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let devLog = '';
  devProc.stdout.on('data', (d) => (devLog += d));
  devProc.stderr.on('data', (d) => (devLog += d));

  console.log('Запускаю Chrome headless (swiftshader)...');
  const chromeProc = spawn(
    CHROME_BIN,
    [
      '--headless=new',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      `--remote-debugging-port=${CDP_PORT}`,
      '--window-size=1280,900',
      `--user-data-dir=${USER_DATA_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  chromeProc.stdout.on('data', () => {});
  chromeProc.stderr.on('data', () => {});

  let exitCode = 0;
  try {
    await waitForHttp(DEV_URL);
    console.log('Dev-сервер поднялся:', DEV_URL);

    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const target = await getPageTarget(CDP_PORT);
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.ready;

    client.onEvent((method, params) => {
      if (method === 'Runtime.consoleAPICalled') {
        const text = (params.args || []).map(fmtRemote).join(' ');
        logConsole({ type: 'console', level: params.type, text, ts: Date.now() });
      } else if (method === 'Runtime.exceptionThrown') {
        const ex = params.exceptionDetails;
        const text = ex.exception ? fmtRemote(ex.exception) : ex.text;
        logConsole({
          type: 'exception',
          text: `${ex.text}: ${text}`,
          url: ex.url,
          line: ex.lineNumber,
          ts: Date.now(),
        });
      } else if (method === 'Log.entryAdded') {
        const e = params.entry;
        logConsole({ type: 'log', level: e.level, text: e.text, source: e.source, ts: Date.now() });
      }
    });

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');

    const loadPromise = new Promise((resolve) => {
      client.onEvent((method) => {
        if (method === 'Page.loadEventFired') resolve();
      });
    });
    await client.send('Page.navigate', { url: DEV_URL });
    await Promise.race([loadPromise, sleep(15000)]);

    console.log('Страница загружена, жду прогрузку глобуса...');
    await sleep(4000);

    async function screenshot(name) {
      const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path.join(OUT_DIR, name), Buffer.from(data, 'base64'));
      console.log('Скриншот сохранён:', name);
    }

    async function evalJs(expr) {
      const result = await client.send('Runtime.evaluate', {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        console.error('EVAL ERROR:', JSON.stringify(result.exceptionDetails));
      }
      return result.result;
    }

    // Проверяем, что dev-хуки действительно установлены (import.meta.env.DEV сработал).
    const hooksPresent = await evalJs(
      'typeof window.__strike === "function" && typeof window.__reset === "function" && typeof window.__lookAt === "function"',
    );
    console.log('dev-хуки присутствуют:', fmtRemote(hooksPresent));
    if (!fmtRemote(hooksPresent).includes('true')) {
      throw new Error(
        'window.__strike/__reset/__lookAt не установлены — installDevHooks не сработал',
      );
    }

    // --- Удар по суше (Сахара) ---
    console.log('Удар по суше 20,23...');
    await evalJs('window.__strike(20, 23, 100)');
    await evalJs('window.__lookAt(20, 23)');
    await sleep(5000);
    await screenshot('01-land.png');
    await evalJs('window.__reset()');
    await sleep(500);

    // --- Удар по воде (Тихий океан) ---
    console.log('Удар по воде -140,0...');
    await evalJs('window.__strike(-140, 0, 100)');
    await evalJs('window.__lookAt(-140, 0)');
    await sleep(5000);
    await screenshot('02-water.png');
    await evalJs('window.__reset()');
    await sleep(500);

    // --- Удар по льду (Антарктида) ---
    console.log('Удар по льду 0,-80...');
    await evalJs('window.__strike(0, -80, 100)');
    await evalJs('window.__lookAt(0, -80)');
    await sleep(5000);
    await screenshot('03-ice.png');
    await evalJs('window.__reset()');
    await sleep(500);
    await screenshot('04-after-reset.png');

    // --- Прогрессия: три удара 100Мт в одну точку (воксельная кора копается до магмы) ---
    console.log('Прогрессия: 3×100Мт в одну точку...');
    await evalJs('window.__reset()');
    await sleep(500);
    await evalJs('window.__lookAt(20, 23)');
    await evalJs('window.__strike(20, 23, 100)');
    await sleep(4000);
    await screenshot('05-crust-hit1.png');
    await evalJs('window.__strike(20, 23, 100)');
    await sleep(4000);
    await screenshot('06-crust-hit2.png');
    await evalJs('window.__strike(20, 23, 100)');
    await sleep(4000);
    await screenshot('07-crust-hit3.png');
    // скол на силуэте: удар по краю видимого диска
    await evalJs('window.__lookAt(60, 10)');
    await sleep(300);
    await screenshot('08-crust-limb.png');

    writeFileSync(path.join(OUT_DIR, 'console-log.json'), JSON.stringify(consoleLog, null, 2));
    console.log('Консоль-лог сохранён. Всего записей:', consoleLog.length);

    const bad = consoleLog.filter(isBad);
    if (bad.length) {
      console.error('НАЙДЕНЫ ПОДОЗРИТЕЛЬНЫЕ ЗАПИСИ КОНСОЛИ:', bad.length);
      console.error(JSON.stringify(bad, null, 2));
      exitCode = 1;
    } else {
      console.log('Консоль чиста от ошибок рендера/исключений.');
    }

    client.close();
  } catch (err) {
    console.error('ОШИБКА ПРИЁМКИ:', err);
    exitCode = 1;
  } finally {
    chromeProc.kill('SIGKILL');
    devProc.kill('SIGTERM');
    if (exitCode !== 0) console.error('--- хвост лога dev-сервера ---\n' + devLog.slice(-2000));
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('ФАТАЛЬНАЯ ОШИБКА ХАРНЕССА:', err);
  process.exit(1);
});
