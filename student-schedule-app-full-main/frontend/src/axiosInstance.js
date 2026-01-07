import axios from "axios";

// ✅ 환경에 따라 항상 올바른 API 주소로 가도록 baseURL 계산
const makeBaseURL = () => {
  const host = window.location.hostname;
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host); // IP

  // 로컬 개발은 백엔드:5000, 배포는 동일 출처 /api
  if (isLocal) return "http://localhost:5000/api";
  return `${window.location.origin}/api`;
};

const axiosInstance = axios.create({
  baseURL: makeBaseURL(),
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
        if (!config.headers.Authorization) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch (_) {}
    return config;
  },
  (error) => Promise.reject(error)
);

// ✅ admin 영역 판별 (로그인 페이지는 제외)
const isAdminArea = () => {
  const p = window.location.pathname;
  // /admin 또는 /admin/xxx 는 포함, /admin-login 은 제외
  return /^\/admin(\/|$)/.test(p) && p !== "/admin-login";
};

// ✅ 응답 인터셉터: 1) HTML 응답 감지, 2) 401/403 → /admin-login 리다이렉트
axiosInstance.interceptors.response.use(
  (response) => {
    // 응답 가드: JSON 대신 HTML이 오면 경고 찍기(프록시/리라이트 문제 힌트)
    const ct =
      response?.headers?.["content-type"] ||
      response?.headers?.get?.("content-type");
    if (ct && typeof ct === "string" && ct.includes("text/html")) {
      const cfg = response.config || {};
      // eslint-disable-next-line no-console
      console.error(
        "[API WARNING: HTML response]",
        (cfg.method || "GET").toUpperCase(),
        (cfg.baseURL || "") + (cfg.url || "")
      );
    }

    // 응답 본문이 완전히 비어있으면 경고 (서버 미들웨어/리라이트 문제일 수 있음)
    if (typeof response?.data === "undefined") {
      const cfg = response.config || {};
      // eslint-disable-next-line no-console
      console.error(
        "[API WARNING: empty data]",
        (cfg.method || "GET").toUpperCase(),
        (cfg.baseURL || "") + (cfg.url || "")
      );
    }

    return response;
  },
  (error) => {
    const status = error?.response?.status;
    const cfg = error?.config || {};
    const ct = error?.response?.headers?.["content-type"];

    // HTML 에러 응답(프록시/리라이트 꼬임 의심) 로그
    if (ct && typeof ct === "string" && ct.includes("text/html")) {
      // eslint-disable-next-line no-console
      console.error(
        "[API ERROR: HTML response]",
        (cfg.method || "GET").toUpperCase(),
        (cfg.baseURL || "") + (cfg.url || ""),
        status
      );
    }

    // 401/403: 관리자 보호 구역에서만 로그인으로 보냄
    if ((status === 401 || status === 403) && isAdminArea()) {
      try {
        // 필요하면 주석 해제하여 자동 로그아웃
        // localStorage.removeItem("adminToken");
        // localStorage.removeItem("studentToken");
        // localStorage.removeItem("token");
      } catch {}
      // ✅ 라우터가 사용하는 정확한 경로로 리다이렉트
      window.location.replace("/admin-login");
      // 진행 중단 (Promise 미해결로)
      return new Promise(() => {});
    }

    return Promise.reject(error);
  }
);

export default axiosInstance;
