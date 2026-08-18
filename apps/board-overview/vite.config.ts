import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// vite is invoked as `vite build --config apps/board-overview/vite.config.ts`
// from the repo root, so `root` must be pinned here rather than relying on
// vite's CWD-relative default.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'mcp-app.html',
    },
  },
});
