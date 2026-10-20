import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/contour-editor/',
  plugins: [react()],
  resolve: {
    // Use the same fully local TeX font for MathJax's fallback import as fontData.
    // This avoids bundling a second, unused NewCM font family.
    alias: { '#default-font/svg/default.js': '@mathjax/mathjax-tex-font/mjs/svg/default.js' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
