// frontend/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    open: true,
    proxy: {
      "/api": {
        target: "http://localhost:5000", // 백엔드 포트
        changeOrigin: true,
        secure: false,                  // HTTP일 때 안전하게 연결
        // rewrite: path => path,       // 경로 그대로 유지 (기본값)
      },
    },
  },
  preview: {
    port: 5173,
  },
});
