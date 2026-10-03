import { defineConfig } from 'vite';
import { standaloneBundle } from './scripts/standalone-bundle';
import { compressedFonts } from './scripts/compressed-fonts';

export default defineConfig({
  plugins: [compressedFonts(), standaloneBundle()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist',
    // The regular library build and declarations live in the same directory.
    emptyOutDir: false,
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
    lib: { entry: 'src/index.ts', name: 'Htpo', formats: ['iife'], fileName: () => 'htpo.min.js' },
    rollupOptions: {
      external: [],
      output: { inlineDynamicImports: true },
    },
  },
});
