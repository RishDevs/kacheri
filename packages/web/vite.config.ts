import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const demo = process.env.VITE_DEMO === '1';
const base = (process.env.VITE_BASE || '/').replace(/\/?$/, '/');

function demoCaseFiles(): string[] {
  try {
    const dir = fileURLToPath(new URL('./public/demo/cases', import.meta.url));
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

export default defineConfig({
  base,
  plugins: [react()],
  define: {
    __KACHERI_DEMO__: JSON.stringify(demo),
    __KACHERI_BASE__: JSON.stringify(base),
    __KACHERI_DEMO_CASES__: JSON.stringify(demoCaseFiles()),
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
