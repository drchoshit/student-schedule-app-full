import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import StudentLogin from "./pages/StudentLogin";
import ScheduleInput from "./pages/ScheduleInput";
import AdminDashboard from "./pages/AdminDashboard";
import AdminLogin from "./pages/AdminLogin"; // ✅ 관리자 로그인 페이지

// ✅ PrivateRoute: 관리자 JWT 토큰 기반 보호
const PrivateRoute = ({ children }) => {
  const token = localStorage.getItem("adminToken");
  return token ? children : <Navigate to="/admin-login" replace />;
};

function App() {
  return (
    <Router>
      <Routes>
        {/* ✅ 기본 경로 → 학생 로그인 */}
        <Route path="/" element={<Navigate to="/login" replace />} />

        {/* ✅ 학생 로그인 */}
        <Route path="/login" element={<StudentLogin />} />

        {/* ✅ 학생 일정 입력 (컴포넌트 내부에서 로그인 체크 & 리다이렉트 처리) */}
        <Route path="/schedule" element={<ScheduleInput />} />

        {/* ✅ 관리자 로그인 */}
        <Route path="/admin-login" element={<AdminLogin />} />

        {/* ✅ 관리자 페이지 (JWT 토큰 필요) */}
        <Route
          path="/admin"
          element={
            <PrivateRoute>
              <AdminDashboard />
            </PrivateRoute>
          }
        />

        {/* ✅ 잘못된 URL → 로그인 */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
