import { defineConfig } from 'vitest/config';

export default defineConfig({
  // База путей ассетов. Локально — '/' (dev-сервер и accept-харнесс не трогаем);
  // деплой на GitHub Pages задаёт DEPLOY_BASE='/<имя-репо>/' в workflow
  // (.github/workflows/deploy.yml), т.к. сайт живёт в поддиректории username.github.io/<репо>/.
  base: process.env.DEPLOY_BASE ?? '/',
  test: {
    globals: true,
    environment: 'node',
    // Дефолтные 5 с vitest рассчитаны на юнит-тесты, а в test/sim/ живут ИНТЕГРАЦИОННЫЕ
    // прогоны целых партий: «reset начинает партию заново» проигрывает 900 + 900 игровых
    // секунд, то есть ~54 000 тиков симуляции. На быстрой машине это ~2 с, но при
    // параллельном прогоне всех файлов на машине послабее упирается в 5 с и падает по
    // таймауту — при полностью исправном коде. 20 с дают запас и по-прежнему ловят
    // настоящее зависание.
    testTimeout: 20000,
    setupFiles: ['./vitest.setup.ts'],
    include: ['test/**/*.test.ts'],
  },
});
