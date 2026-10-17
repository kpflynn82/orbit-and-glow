import { defineConfig } from 'vite';

// `npm run build` → dist/ (for Vercel). `npm run build:single` → dist-single/ then
// tools/inline-build.mjs folds everything into one HTML file (for a shareable phone link).
export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
  },
}));
