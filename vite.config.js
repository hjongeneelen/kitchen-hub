import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { recipeEditorApi } from './vite-plugins/recipeEditorApi.js'

// Change this to match your GitHub repository name, e.g. '/kitchen-hub/'.
// If deploying to a user/org page (username.github.io), set this to '/'.
const REPO_NAME = '/kitchen-hub/'

export default defineConfig({
  plugins: [
    react(),
    recipeEditorApi(),
    VitePWA({
      registerType: 'autoUpdate',
      // Recipes are bundled into the JS at build time (import.meta.glob), so
      // they're already offline-available once the app shell is cached —
      // this runtime caching is specifically for the deals/ingredient-price
      // JSON, which are fetched separately at runtime.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/data/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'kitchen-hub-data',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
      manifest: {
        name: 'Kitchen Hub',
        short_name: 'Kitchen Hub',
        description: 'Recepten, boodschappenprijzen en aanbiedingen in één app.',
        start_url: REPO_NAME,
        scope: REPO_NAME,
        display: 'standalone',
        background_color: '#faf4ea',
        theme_color: '#b5551f',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  base: REPO_NAME,
  server: {
    // Binds to all network interfaces (LAN + Tailscale), not just localhost,
    // so the dev server is reachable from other devices on your tailnet.
    host: true,
    port: 5173,
  },
})
