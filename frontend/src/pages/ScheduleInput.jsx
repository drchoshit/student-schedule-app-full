// frontend/src/pages/ScheduleInput.jsx
import React, { useState, useEffect } from "react";
import axios from "../axiosInstance";
import { useNavigate } from "react-router-dom";

export default function ScheduleInput() {
  const navigate = useNavigate();
  const days = ["월", "화", "수", "목", "금", "토", "일"];

  const [settings, setSettings] = useState({
    week_range_text: "",
    external_desc: "",
    external_example: "",
    center_desc: "",
    center_example: "",
    notification_footer: ""
  });

  const [student, setStudent] = useState(() => {
    const stored = localStorage.getItem("student");
    return stored ? JSON.parse(stored) : null;
  });

  // 초기 스케줄 데이터
  const createInitialData = () => ({
    외부: days.map(() => [
      { day: "", start: "", startMin: "", end: "", endMin: "", memo: "" },
    ]),
    센터: days.map(() => [
      { day: "", start: "", startMin: "", end: "", endMin: "" },
    ]),
  });
  const [schedule, setSchedule] = useState(createInitialData());

  // 시간/분 옵션
  const hourOptions = [
    ...Array.from({ length: 16 }, (_, i) => (i + 8).toString().padStart(2, "0")), // 08~23
    "00", "01", "02"
  ];
  const minutesOptions = ["00", "10", "20", "30", "40", "50"];

  const [loading, setLoading] = useState(false);

  // 문자 발송 관련 상태
  const [studentPhone, setStudentPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");

  // 미리보기 모달 상태
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [previewTarget, setPreviewTarget] = useState(""); // "student" | "parent"

  // 로그인 체크
  useEffect(() => {
    if (!student) {
      alert("로그인이 필요합니다.");
      navigate("/login");
    }
  }, [student, navigate]);

  // ✅ 설정 로딩 (학생용)
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        console.log("[ScheduleInput] GET /student/settings 요청");
        const res = await axios.get(`/student/settings`);
        console.log("[ScheduleInput] settings 응답:", res.status, res.data);
        setSettings({
          week_range_text: res.data?.week_range_text ?? "",
          external_desc: res.data?.external_desc ?? "",
          external_example: res.data?.external_example ?? "",
          center_desc: res.data?.center_desc ?? "",
          center_example: res.data?.center_example ?? "",
          notification_footer: res.data?.notification_footer ?? "",
        });
      } catch (error) {
        console.error("❌ 설정 불러오기 오류:", error);
        alert(
          `설정 불러오기 실패: ${error.response?.status || ""} ${error.response?.data?.error || error.message}`
        );
      }
    };
    fetchSettings();
  }, []);

  // 로그아웃
  const handleLogout = () => {
    localStorage.removeItem("student");
    setStudent(null);
    navigate("/login");
  };

  // 행 추가/삭제/변경
  const addRow = (section, dayIndex) => {
    const next = { ...schedule };
    next[section][dayIndex].push({
      day: days[dayIndex], start: "", startMin: "", end: "", endMin: "", memo: ""
    });
    setSchedule(next);
  };
  const removeRow = (section, dayIndex, rowIndex) => {
    const next = { ...schedule };
    next[section][dayIndex].splice(rowIndex, 1);
    setSchedule(next);
  };
  const handleChange = (section, dayIndex, rowIndex, field, value) => {
    const next = { ...schedule };
    next[section][dayIndex][rowIndex][field] = value;
    next[section][dayIndex][rowIndex].day = days[dayIndex];
    setSchedule(next);
  };

  // 모의 카카오 알림
  const sendKakaoNotification = (summaryText) => {
    console.log(`[카카오톡 발송] 대상: ${student?.name || "학생"}`);
    console.log("메시지 내용:\n", summaryText);
    alert(summaryText);
  };

  // 저장
  const handleSave = async () => {
    if (!student?.id) {
      alert("학생 ID가 없습니다. 다시 로그인하세요.");
      navigate("/login");
      return;
    }

    try {
      const allSchedules = [];

      ["외부", "센터"].forEach((section) => {
        schedule[section].forEach((rows, dayIndex) => {
          rows.forEach((item) => {
            if (item.start && item.end && item.startMin && item.endMin) {
              allSchedules.push({
                day: days[dayIndex],
                start: `${item.start}:${item.startMin}`,
                end: `${item.end}:${item.endMin}`,
                type: section,
                description: item.memo || "",
              });
            } else if (item.start || item.end || item.startMin || item.endMin) {
              alert(`${days[dayIndex]} 요일의 ${section} 일정에서 입력이 불완전합니다. 모든 시간을 선택하세요.`);
              throw new Error("불완전한 입력");
            }
          });
        });
      });

      for (let s of allSchedules) {
        const startTime = parseInt(s.start.replace(":", ""));
        const endTime = parseInt(s.end.replace(":", ""));
        if (endTime <= startTime) {
          s.crossDay = true; // 표시용
        }
      }

      setLoading(true);

      await axios.post(`/student/schedule`, {
        student_id: student?.id,
        schedules: allSchedules,
      });

      const existing = JSON.parse(localStorage.getItem("studentSchedules") || "[]");
      const updated = existing.filter((s) => s.id !== student.id);
      updated.push({
        id: student.id,
        name: student.name,
        schedule: allSchedules,
        completed: true,
      });
      localStorage.setItem("studentSchedules", JSON.stringify(updated));

      // 요약 메시지 생성
      const allDays = ["월", "화", "수", "목", "금", "토", "일"];
      const perDay = Object.fromEntries(allDays.map((d) => [d, []]));

      allSchedules.forEach((s) => {
        const tag = s.type === "센터" ? "(메디컬)" : s.description ? `(${s.description})` : "";
        perDay[s.day].push(`${s.start}~${s.end}${tag}`);
      });

      let summaryText = `${student.name} 학생의 이번 주(${settings.week_range_text || ""}) 일정\n\n`;
      allDays.forEach((day) => {
        summaryText += `${day}: ${perDay[day].join(", ")}\n`;
      });
      if (settings.notification_footer) {
        summaryText += `\n${settings.notification_footer}`;
      }

      sendKakaoNotification(summaryText);
      alert("스케줄이 저장되었습니다!");
    } catch (error) {
      console.error("❌ 저장 오류:", error);
      alert(`저장 실패: ${error.response?.status || ""} ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 문자 미리보기
  const handlePreview = (target) => {
    if (target === "student" && !studentPhone) {
      alert("학생 전화번호를 입력하세요.");
      return;
    }
    if (target === "parent" && !parentPhone) {
      alert("보호자 전화번호를 입력하세요.");
      return;
    }
    setPreviewTarget(target);
    setPreviewText(generateMessage());
    setPreviewOpen(true);
  };

  // 문자 내용 생성
  const generateMessage = () => {
    return `[안내] ${student.name}님의 이번 주 일정\n` +
      Object.entries(scheduleSummary()).map(([day, times]) => `${day}: ${times}`).join("\n") +
      (settings.notification_footer ? `\n${settings.notification_footer}` : "");
  };

  // 요약
  const scheduleSummary = () => {
    const result = {};
    const allDays = ["월", "화", "수", "목", "금", "토", "일"];
    allDays.forEach((d) => (result[d] = ""));

    ["외부", "센터"].forEach((section) => {
      schedule[section].forEach((rows, idx) => {
        const day = allDays[idx];
        const blocks = rows
          .filter((r) => r.start && r.end && r.startMin && r.endMin)
          .map((r) => {
            const start = `${r.start}:${r.startMin}`;
            const end = `${r.end}:${r.endMin}`;
            const tail = section === "센터" ? "(메디컬)" : r.memo ? `(${r.memo})` : "";
            return `${start}~${end}${tail}`;
          });
        if (!blocks.length) return;
        result[day] = result[day] ? `${result[day]}, ${blocks.join(", ")}` : blocks.join(", ");
      });
    });
    return result;
  };

  // 문자 발송
  const handleSendSms = async () => {
    try {
      const phone = previewTarget === "student" ? studentPhone : parentPhone;
      await axios.post(`/sms/send`, { to: phone, text: previewText });
      alert("✅ 문자 발송 성공!");
      setPreviewOpen(false);
    } catch (error) {
      console.error("저장 오류:", error.response?.data || error.message);
      alert(`저장 실패: ${error.response?.status || ""} ${error.response?.data?.error || error.message}`);
    }
  };

  const studentName = localStorage.getItem("studentName") || student?.name || "???";

  return (
    <div className="max-w-6xl mx-auto p-4">

      {/* 상단 학생 이름 + 로그아웃 */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">
          {`${studentName}님의 이번 주 스케줄 입력`}
        </h2>
        <button
          onClick={handleLogout}
          className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
        >
          로그아웃
        </button>
      </div>

      {/* ✅ 관리자 설정 표시 */}
      <p className="mb-6 text-gray-700">
        📅 {settings.week_range_text || "이번 주 범위가 표시됩니다"}
      </p>

      {/* 외부 & 센터 일정 가로 배치 */}
      <div className="flex gap-6">
        {["외부", "센터"].map((section) => (
          <div key={section} className="flex-1 border rounded p-4 shadow-md">
            <h3 className="font-semibold text-lg mb-2">
              {section} 일정 입력
            </h3>

            {/* ✅ 설명/예시 표기 */}
            <p className="text-gray-600 mb-1">
              {section === "외부" ? (settings.external_desc || "") : (settings.center_desc || "")}
            </p>
            <p className="text-sm text-gray-500 mb-4">
              예시: {section === "외부" ? (settings.external_example || "") : (settings.center_example || "")}
            </p>

            {schedule[section].map((rows, dayIndex) => (
              <div key={dayIndex} className="mb-4">
                <strong className="block mb-2">{days[dayIndex]}:</strong>
                {rows.map((item, rowIndex) => (
                  <div key={rowIndex} className="flex items-center mb-2 gap-2">
                    <select
                      value={item.start}
                      onChange={(e) => handleChange(section, dayIndex, rowIndex, "start", e.target.value)}
                      className="border p-2 rounded"
                    >
                      <option value="">시</option>
                      {hourOptions.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    :
                    <select
                      value={item.startMin}
                      onChange={(e) => handleChange(section, dayIndex, rowIndex, "startMin", e.target.value)}
                      className="border p-2 rounded"
                    >
                      <option value="">분</option>
                      {minutesOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    ~
                    <select
                      value={item.end}
                      onChange={(e) => handleChange(section, dayIndex, rowIndex, "end", e.target.value)}
                      className="border p-2 rounded"
                    >
                      <option value="">시</option>
                      {hourOptions.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    :
                    <select
                      value={item.endMin}
                      onChange={(e) => handleChange(section, dayIndex, rowIndex, "endMin", e.target.value)}
                      className="border p-2 rounded"
                    >
                      <option value="">분</option>
                      {minutesOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>

                    {section === "외부" && (
                      <input
                        type="text"
                        placeholder="메모 (예: 학교)"
                        value={item.memo}
                        onChange={(e) => handleChange(section, dayIndex, rowIndex, "memo", e.target.value)}
                        className="border p-2 rounded flex-1"
                      />
                    )}

                    <button
                      onClick={() => removeRow(section, dayIndex, rowIndex)}
                      className="text-red-500 hover:underline whitespace-nowrap px-2"
                      style={{ display: "inline-block" }}
                    >
                      삭제
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addRow(section, dayIndex)}
                  className="text-blue-500 text-sm hover:underline"
                >
                  + 추가
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 저장 버튼 */}
      <div className="text-center mt-8">
        <button
          onClick={handleSave}
          className={`bg-blue-600 text-white px-8 py-3 rounded-lg text-lg font-bold shadow-md ${
            loading ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-700"
          }`}
          disabled={loading}
        >
          {loading ? "저장 중..." : "입력 내용 제출"}
        </button>

        {/* 문자 발송 UI */}
        <div className="mt-6 flex flex-col items-center gap-4">
          <input
            type="text"
            placeholder="학생 전화번호 입력 (예: 01012345678)"
            value={studentPhone}
            onChange={(e) => setStudentPhone(e.target.value)}
            className="border p-2 rounded w-64"
          />
          <input
            type="text"
            placeholder="보호자 전화번호 입력 (예: 01098765432)"
            value={parentPhone}
            onChange={(e) => setParentPhone(e.target.value)}
            className="border p-2 rounded w-64"
          />
          <div className="flex gap-4">
            <button
              onClick={() => handlePreview("student")}
              className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
            >
              학생에게 발송
            </button>
            <button
              onClick={() => handlePreview("parent")}
              className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600"
            >
              보호자에게 발송
            </button>
          </div>
        </div>
      </div>

      {/* 문자 발송 미리보기 모달 */}
      {previewOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white rounded p-6 w-96 shadow-lg">
            <h2 className="text-xl font-bold mb-4">문자 발송 미리보기</h2>
            <textarea
              readOnly
              className="w-full border p-2 rounded mb-4"
              rows={8}
              value={previewText}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPreviewOpen(false)}
                className="bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500"
              >
                취소
              </button>
              <button
                onClick={handleSendSms}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                발송
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
