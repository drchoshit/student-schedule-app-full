// frontend/src/App.jsx
import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import StudentLogin from "./pages/StudentLogin";
import ScheduleInput from "./pages/ScheduleInput";
import AdminDashboard from "./pages/AdminDashboard";
import AdminLogin from "./pages/AdminLogin";

/** =======================
 * 전역 에러 바운더리 (백지 방지)
 * ======================= */
class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, msg: "" };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, msg: err?.message || "알 수 없는 오류가 발생했습니다." };
  }
  componentDidCatch(err, info) {
    // 필요시 서버 로깅 추가 가능
    // console.error("GlobalErrorBoundary", err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto" }}>
          <h2 style={{ marginBottom: 8 }}>문제가 발생했어요 😥</h2>
          <p style={{ color: "#666", marginBottom: 16 }}>{this.state.msg}</p>
          <button
            onClick={() => (window.location.href = "/admin/login")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
              cursor: "pointer",
              background: "#fff",
            }}
          >
            관리자 로그인으로 이동
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** =======================
 * 관리자 보호 라우트 (토큰 없으면 로그인으로)
 * ======================= */
function PrivateAdminRoute() {
  const token =
    localStorage.getItem("adminToken") ||
    localStorage.getItem("token"); // 레거시 호환
  const loc = useLocation();

  if (!token || token === "null" || token === "undefined") {
    return <Navigate to="/admin/login" replace state={{ from: loc.pathname }} />;
  }
  return <Outlet />;
}

function App() {
  return (
    <Router>
      <GlobalErrorBoundary>
        <Routes>
          {/* 기본 경로 → 학생 로그인 */}
          <Route path="/" element={<Navigate to="/login" replace />} />

          {/* 학생 로그인 */}
          <Route path="/login" element={<StudentLogin />} />

          {/* 학생 일정 입력 (내부에서 로그인 체크) */}
          <Route path="/schedule" element={<ScheduleInput />} />

          {/* 관리자 로그인 (표준 경로) */}
          <Route path="/admin/login" element={<AdminLogin />} />

          {/* 과거 경로 호환: /admin-login → /admin/login */}
          <Route path="/admin-login" element={<Navigate to="/admin/login" replace />} />

          {/* 관리자 보호 구역 */}
          <Route path="/admin" element={<PrivateAdminRoute />}>
            <Route index element={<AdminDashboard />} />
            {/* 필요 시 /admin 하위 라우트 추가
                <Route path="students" element={<AdminStudents />} /> 등 */}
          </Route>

          {/* 잘못된 URL → 로그인 */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </GlobalErrorBoundary>
    </Router>
  );
}

export default App;
