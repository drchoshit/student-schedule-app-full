// frontend/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5000", // ✅ server.js가 여기에 뜸
        changeOrigin: true,
        secure: false,
        // ✅ /api 프리픽스는 백엔드 마운트 경로와 일치하므로 절대 지우지 말기
        // rewrite: (path) => path.replace(/^\/api/, ""), // ❌ 제거
      },
    },
  },
});
