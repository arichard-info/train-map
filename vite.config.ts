import { defineConfig } from 'vite';

export default defineConfig({
  // main.ts uses top-level await to load data before creating the map
  build: { target: 'es2022' },
});
