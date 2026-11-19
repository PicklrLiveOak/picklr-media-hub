import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base + hash routing = works at any GitHub Pages path.
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // We write our own service worker (src/sw.ts) so push notifications can be added in step 2.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,svg,ico}'] },
      manifest: {
        name: 'Picklr Media Hub',
        short_name: 'Media Hub',
        description: 'Media requests, chat and calendar for The Picklr Live Oak',
        theme_color: '#0B0B0C',
        background_color: '#F8F2E6',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
