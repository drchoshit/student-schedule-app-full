import axios from "axios";

// 개발 모드에서는 무조건 /api (Vite 프록시)
const baseURL = import.meta.env.DEV
  ? "/api"
  : (import.meta.env.VITE_API_BASE?.trim?.()
     || import.meta.env.VITE_API_BASE_URL?.trim?.()
     || "/api");

export const api = axios.create({
  baseURL,
  withCredentials: true, // 쿠키 전달
  headers: { "Content-Type": "application/json" },
});

export const adminAPI = {
  me: () => api.get("/admin/me"),
  login: (username, password) =>
    api.post("/admin/login", { username, password }),
  logout: () => api.post("/admin/logout"),
};

export const studentAPI = {
  exportExcel: () =>
    api.get("/admin/students/export-excel", { responseType: "arraybuffer" }),
};

export default api;
