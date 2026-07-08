import { defineConfig } from 'vitest/config';

export default defineConfig({
  // База путей ассетов. Локально — '/' (dev-сервер и accept-харнесс не трогаем);
  // деплой на GitHub Pages задаёт DEPLOY_BASE='/<имя-репо>/' в workflow
  // (.github/workflows/deploy.yml), т.к. сайт живёт в поддиректории username.github.io/<репо>/.
  base: process.env.DEPLOY_BASE ?? '/',
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['test/**/*.test.ts'],
  },
});
