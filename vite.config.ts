import path from "node:path";

import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

/**
 * Build id compiled into the bundle and appended to the service worker
 * registration URL (see main.tsx). Post-processing dist/sw.js does NOT work —
 * Vite copies public/ after the bundle hooks run, so the substitution is
 * silently overwritten and every deploy ships the same cache name.
 */
const BUILD_ID = Date.now().toString(36);

// https://vitejs.dev/config/
export default defineConfig(() => ({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    host: "localhost", // Changed from "::" for better compatibility
    port: 8080,
    open: true, // Automatically open browser when server starts
  },
  plugins: [
    react(),
  ],
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime'],
    force: true, // Force re-optimization
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    onConsoleLog(log) {
      return !log.includes("React Router Future Flag Warning");
    },
    env: {
      DEBUG_PRINT_LIMIT: '0', // Suppress DOM output that exceeds AI context windows
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ['react', 'react-dom'], // Ensure single React instance
  },
}));