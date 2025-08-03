// frontend/src/axiosInstance.js
import axios from "axios";

// 현재 주소가 Render 배포 주소인지 감지
const isRender = window.location.hostname.includes("onrender.com");

// baseURL 설정: Render에 배포된 경우와 로컬 개발을 자동 구분
const axiosInstance = axios.create({
  baseURL: isRender
    ? "https://student-schedule-app-full.onrender.com/api" // ✅ Render 백엔드 주소
    : "http://localhost:5000/api", // ✅ 로컬 백엔드 주소
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 20000,
});

// ✅ 요청 인터셉터: 관리자 JWT 토큰 자동 추가
axiosInstance.interceptors.request.use(
  (config) => {
    try {
      const token = localStorage.getItem("adminToken");
      if (token && token !== "null") {
        config.headers = config.headers || {};
        config.headers["Authorization"] = `Bearer ${token}`;
      }
    } catch (_) {
      // 에러 무시
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ✅ 응답 인터셉터: 인증 실패 시 처리
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      // 자동 로그아웃 또는 로그인 페이지 이동 로직 (필요 시 사용)
      // localStorage.removeItem("adminToken");
      // window.location.href = "/admin/login";
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;
