// frontend/src/axiosInstance.js
import axios from "axios";

// 현재 주소가 Render 배포 주소인지 감지 (현재는 사용 안 하지만 남겨둠)
const isRender = window.location.hostname.includes("onrender.com");

// baseURL 설정: Render에 배포된 경우와 로컬 개발을 자동 구분
const axiosInstance = axios.create({
  baseURL: "/api", // ✅ Vite proxy 또는 Render 동일 출처 프록시 전제
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  timeout: 20000,
});

// ✅ 요청 인터셉터: 관리자/학생 JWT 토큰 자동 추가
axiosInstance.interceptors.request.use(
  (config) => {
    try {
      // 우선순위: adminToken > studentToken > token
      const adminToken = localStorage.getItem("adminToken");
      const studentToken = localStorage.getItem("studentToken");
      const legacyToken = localStorage.getItem("token");
      const token = adminToken || studentToken || legacyToken;

      if (token && token !== "null" && token !== "undefined") {
        config.headers = config.headers || {};
        // 이미 Authorization이 없다면만 설정
        if (!config.headers.Authorization) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch (_) {
      // 에러 무시
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ✅ 응답 인터셉터: 인증 실패 시 처리 (필요 시 라우팅 추가 가능)
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      // 필요 시 자동 로그아웃/리다이렉트 구현
      // localStorage.removeItem("adminToken");
      // localStorage.removeItem("studentToken");
      // localStorage.removeItem("token");
      // window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;
