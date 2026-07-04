import tseslint from 'typescript-eslint';

export default tseslint.config({ ignores: ['dist/**'] }, ...tseslint.configs.recommended, {
  files: ['src/sim/**/*.ts', 'src/ecs/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: ['three', 'three/*'], message: 'sim/ecs не зависят от рендера (three).' },
          { group: ['**/render/*', '**/ui/*', '**/input/*'], message: 'sim/ecs — чистые слои.' },
        ],
      },
    ],
    'no-restricted-properties': [
      'error',
      { object: 'Math', property: 'random', message: 'Только seeded RNG из core/time.' },
      { object: 'Date', property: 'now', message: 'Только часы из core/time.' },
    ],
  },
});
