// frontend/src/axiosInstance.js
import axios from "axios";

// ✅ 현재 호스트 이름에 따라 baseURL 결정
const isRender = window.location.hostname.includes("onrender.com");
const baseURL = isRender ? "/api" : "http://localhost:5000/api";

const axiosInstance = axios.create({
  baseURL,
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
        config.headers['Authorization'] = `Bearer ${token}`;
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
      // 👉 옵션: 자동 로그아웃 로직
      // localStorage.removeItem("adminToken");
      // window.location.href = "/admin/login";
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;
