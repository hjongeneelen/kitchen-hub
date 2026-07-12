import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { recipeEditorApi } from './vite-plugins/recipeEditorApi.js'

// Change this to match your GitHub repository name, e.g. '/kitchen-hub/'.
// If deploying to a user/org page (username.github.io), set this to '/'.
const REPO_NAME = '/kitchen-hub/'

export default defineConfig({
  plugins: [react(), recipeEditorApi()],
  base: REPO_NAME,
  server: {
    // Binds to all network interfaces (LAN + Tailscale), not just localhost,
    // so the dev server is reachable from other devices on your tailnet.
    host: true,
    port: 5173,
  },
})
