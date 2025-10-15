import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// ✅ 요점
// - 운영(빌드 후)은 /api 같은 상대경로만 쓰면 되고, 프록시는 개발 서버에서만 동작.
// - 개발 중에는 프록시가 Render 백엔드(또는 로컬)로 /api, /uploads를 넘겨준다.
// - .env에 DEV_PROXY_TARGET 넣으면 우선 사용 (없으면 http://localhost:5000)

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const DEV_PROXY_TARGET = env.DEV_PROXY_TARGET || 'http://localhost:5000'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // 예) /api/admin/login  →  DEV_PROXY_TARGET/api/admin/login
        '/api': {
          target: DEV_PROXY_TARGET,
          changeOrigin: true,
          secure: false,       // 개발 편의를 위해 TLS 검증 off (https 프록시 시)
          // ws: false,
        },
        // 이미지 업로드/조회도 동일하게 프록시
        '/uploads': {
          target: DEV_PROXY_TARGET,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    // ✅ 운영(빌드)에서는 프런트가 /api 상대경로를 그대로 사용
    //    (백엔드가 정적파일과 API를 같은 도메인에서 제공)
    //    즉 별도의 baseURL 강제 변경 필요 없음.
  }
})
