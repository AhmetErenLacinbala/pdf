import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));

function copyPdfjsBrowserAssets(): Plugin {
  const sync = () => {
    const publicDir = path.resolve('public');
    const pdfjsPublicDir = path.join(publicDir, 'pdfjs');
    mkdirSync(pdfjsPublicDir, { recursive: true });
    cpSync(
      path.join(pdfjsRoot, 'build', 'pdf.worker.min.mjs'),
      path.join(pdfjsPublicDir, 'pdf.worker.min.mjs'),
    );
    for (const dir of ['wasm', 'cmaps', 'standard_fonts', 'iccs'] as const) {
      const src = path.join(pdfjsRoot, dir);
      if (!existsSync(src)) continue;
      cpSync(src, path.join(publicDir, 'pdfjs', dir), { recursive: true });
    }
  };

  return {
    name: 'copy-pdfjs-browser-assets',
    buildStart: sync,
    configureServer() {
      sync();
    },
  };
}

export default defineConfig({
  plugins: [react(), copyPdfjsBrowserAssets()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
