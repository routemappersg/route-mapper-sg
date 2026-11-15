import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin/index.html') } } },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: { navigateFallbackDenylist: [/^\/admin/] },
      manifest: {
        name: 'Route Mapper SG',
        short_name: 'Route Mapper',
        description: 'Many stops. One smart route.',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        share_target: { action: '/', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'] },
});
