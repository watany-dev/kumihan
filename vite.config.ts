import { defineConfig } from 'vite-plus'

export default defineConfig({
  lint: {
    ignorePatterns: ['dist/**', 'build/**', 'coverage/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      'no-console': ['error', { allow: ['error', 'log'] }],
    },
  },
  fmt: {
    ignorePatterns: ['dist/**', 'build/**', 'coverage/**', 'bun.lock'],
    singleQuote: true,
    semi: false,
    sortPackageJson: true,
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
