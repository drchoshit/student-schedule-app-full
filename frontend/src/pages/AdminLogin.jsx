// frontend/src/pages/AdminLogin.jsx
import React, { useState } from "react";
import axios from "../axiosInstance";
import { useNavigate } from "react-router-dom";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    try {
      // 1) 로그인 요청
      const res = await axios.post("/admin/login", { username, password });

      // 2) 토큰 꺼내기
      const token = res?.data?.token;
      if (!token) {
        alert("로그인 응답에 토큰이 없습니다.");
        return;
      }

      // 3) localStorage 저장
      localStorage.setItem("adminToken", token);

      // 4) 즉시 인스턴스에도 반영(첫 API 호출에서 토큰 누락 방지)
      axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;

      console.log("✅ adminToken 저장됨:", token.slice(0, 16) + "...");

      alert("로그인 성공!");
      // 5) 관리자 대시보드로 이동
      navigate("/admin", { replace: true });
    } catch (err) {
      console.error("❌ 로그인 실패:", err.response?.data || err.message);
      alert(err.response?.data?.error || "로그인 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">관리자 로그인</h1>
      {/* ❗ 여기: handleSubmit → handleLogin 으로 수정 */}
      <form onSubmit={handleLogin} className="space-y-3">
        <input
          className="border p-2 rounded w-full"
          placeholder="아이디"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
        <input
          className="border p-2 rounded w-full"
          placeholder="비밀번호"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <button
          className={`bg-blue-600 text-white px-4 py-2 rounded ${
            loading ? "opacity-60" : "hover:bg-blue-700"
          }`}
          disabled={loading}
          type="submit"
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </form>
    </div>
  );
}
