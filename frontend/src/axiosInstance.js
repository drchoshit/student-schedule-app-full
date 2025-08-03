// frontend/src/axiosInstance.js
import axios from "axios";

const axiosInstance = axios.create({
  baseURL: "/api", // ✅ 상대 경로 사용 → 배포 시에도 정상 작동
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
      if (token && token !== "null") { // ✅ "null" 문자열 예외 처리
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
