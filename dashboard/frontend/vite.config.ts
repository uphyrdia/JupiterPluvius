import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` serves the app on :5173 and forwards /api/* to the FastAPI backend on :8000,
    // so the code can use the same relative URLs (/api/latest) in development and in production.
    proxy: { "/api": "http://localhost:8000" },
  },
  build: {
    // The 3D chunk (three.js and its post-processing) is about 1 MB before gzip; it's loaded lazily anyway.
    chunkSizeWarningLimit: 1000,
  },
});
