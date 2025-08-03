// frontend/src/axiosInstance.js
import axios from "axios";

// ✅ 환경 구분 (배포 vs 개발)
const isRender = typeof window !== "undefined" && window.location.hostname.includes("onrender.com");

// ✅ Render 배포용 기본 주소
const renderBaseURL = "https://student-schedule-app-full.onrender.com/api";

const axiosInstance = axios.create({
  baseURL: isRender ? renderBaseURL : "/api",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json"
  },
  timeout: 20000
});

// ✅ 요청 인터셉터: 관리자 JWT 자동 첨부
axiosInstance.interceptors.request.use(
  (config) => {
    try {
      const token = localStorage.getItem("adminToken");
      if (token && token !== "null") {
        config.headers = config.headers || {};
        config.headers["Authorization"] = `Bearer ${token}`;
      }
    } catch (_) {
      // 로컬스토리지 접근 실패해도 무시
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ✅ 응답 인터셉터: 인증 오류 처리
axiosInstance.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401 || error?.response?.status === 403) {
      // 자동 로그아웃 옵션
      // localStorage.removeItem("adminToken");
      // window.location.href = "/admin/login";
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;
