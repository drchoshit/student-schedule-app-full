import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

export default function PrivateAdminRoute() {
  const token =
    localStorage.getItem("adminToken") ||
    localStorage.getItem("token"); // 레거시 호환
  const loc = useLocation();

  // 토큰 없으면 로그인으로
  if (!token || token === "null" || token === "undefined") {
    return <Navigate to="/admin/login" replace state={{ from: loc.pathname }} />;
  }
  return <Outlet />;
}
