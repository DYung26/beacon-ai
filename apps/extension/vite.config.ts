import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'content-loader': path.resolve(__dirname, 'src/content/loader.ts'),
        // NOTE: overlay.js is NO LONGER a separate entry point.
        // The overlay is imported directly in content/loader.ts to avoid
        // CSP violations from DOM script injection.
      },
      output: {
        entryFileNames: '[name].js',
        dir: 'dist',
        // ES modules for dynamically loaded scripts
        format: 'es',
      },
    },
    // Disable CSS code splitting and dynamic imports
    // CSS should be declared in manifest only, not dynamically loaded via <link> tags
    // This prevents CSP violations on sites like GitHub
    cssCodeSplit: false,
    // Disable modulepreload which tries to inject <link rel="modulepreload">
    // This causes CSP violations. Instead, rely on dynamic imports.
    modulePreload: false,
  },
})
