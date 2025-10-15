import React, { useState, useEffect, useRef } from "react";
// import api from "../axiosInstance"; ❌ axiosInstance 사용 안 함
import axiosInstance from "../axiosInstance"; // ✅
import { useNavigate, useLocation } from "react-router-dom";

export default function StudentLogin() {
  const [name, setName] = useState(""); // ✅ 이름 상태
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false); // ✅ 로딩 상태 추가
  const navigate = useNavigate();
  const location = useLocation();
  const nameInputRef = useRef(null);
  const codeInputRef = useRef(null);

  // ✅ 이미 로그인되어 있으면 스케줄 페이지로 보내기 (원치 않으면 주석 처리)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("student");
      if (saved) {
        navigate("/schedule", { replace: true });
      }
    } catch {}
  }, [navigate]);

  // ✅ URL 파라미터에서 code/name 가져오기
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const codeParam = params.get("code") || "";
    const nameParam = params.get("name") || "";
    if (codeParam) setCode(codeParam);
    if (nameParam) setName(nameParam);

    // code가 있으면 이름 입력에 포커스, 아니면 코드 입력에 포커스
    const t = setTimeout(() => {
      if (nameInputRef.current && codeParam) {
        nameInputRef.current.focus();
      } else if (codeInputRef.current) {
        codeInputRef.current.focus();
      }
    }, 0);
    return () => clearTimeout(t);
  }, [location]);

  const handleLogin = async () => {
    setError("");

    const nameTrim = name.trim();
    const codeTrim = code.trim();

    if (!nameTrim || !codeTrim) {
      setError("이름과 코드를 모두 입력하세요.");
      return;
    }

    setLoading(true); // ✅ 로딩 시작
    try {
      // ✅ axios + 절대경로 사용
      const res = await axiosInstance.post("/student/login", {
        name: nameTrim,
        code: codeTrim,
      });

      if (res.data?.success && res.data.student) {
        let studentData = res.data.student;

        // ✅ name 값이 없으면 입력값으로 덮어쓰기
        if (!studentData.name || studentData.name.trim() === "") {
          studentData = { ...studentData, name: nameTrim };
        }

        // ✅ localStorage에 전체 student 객체 저장
        localStorage.setItem("student", JSON.stringify(studentData));

        // ✅ 추가: 이름과 ID를 별도로 저장 (ScheduleInput에서 사용)
        localStorage.setItem("studentName", studentData.name || nameTrim);
        localStorage.setItem("studentId", studentData.id || codeTrim);

        // ✅ 페이지 이동 후 강제 새로고침 (기존 로직 유지)
        navigate("/schedule", { replace: true });
        window.location.href = "/schedule";
      } else {
        setError(res.data?.error || "로그인 실패. 이름과 코드를 확인하세요.");
      }
    } catch (err) {
      console.error("서버 요청 오류:", err);
      const msg =
        err.response?.data?.error ||
        (err.response ? `서버 오류: ${err.response.status}` : "서버에 연결할 수 없습니다.");
      setError(msg);
    } finally {
      setLoading(false); // ✅ 로딩 종료
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !loading) {
      handleLogin();
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white p-6 rounded shadow-md w-80 text-center">
        <h1 className="text-xl font-bold mb-4">학생 로그인</h1>

        {/* ✅ 이름 입력 */}
        <input
          type="text"
          placeholder="학생 이름 입력"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
          ref={nameInputRef} // ✅ 자동 포커스용
          className={`border w-full p-2 mb-3 rounded focus:ring-2 focus:ring-blue-400 ${
            error ? "border-red-500" : ""
          }`}
        />

        {/* ✅ 코드 입력 */}
        <input
          type="text"
          placeholder="학생 코드 입력"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={onKeyDown}
          ref={codeInputRef}
          className={`border w-full p-2 mb-3 rounded focus:ring-2 focus:ring-blue-400 ${
            error ? "border-red-500" : ""
          }`}
        />

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        <button
          onClick={handleLogin}
          disabled={loading}
          className={`w-full py-2 rounded text-white ${
            loading ? "bg-gray-400 cursor-not-allowed" : "bg-blue-500 hover:bg-blue-600"
          }`}
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </div>
    </div>
  );
}
