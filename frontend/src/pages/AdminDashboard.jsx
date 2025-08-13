// frontend/src/pages/AdminDashboard.jsx
import React, { useEffect, useState } from "react";
import * as XLSX from "xlsx"; // ⬅️⬅️ 추가: 엑셀 파서
import { useNavigate } from "react-router-dom"; // ✅ useNavigate 추가
import CalendarModal from "../components/CalendarModal"; // ✅ 새로 만든 컴포넌트 import
import StudentDetailModal from "../components/StudentDetailModal"; // ✅ 추가
import { exportExternalSchedulesToExcel, exportCenterSchedulesToExcel } from "../utils/exportScheduleToExcel";
import axiosInstance from "../axiosInstance";

/* =========================
   ✅ 공용 응답 가드 유틸
   - 항상 JSON만 반환 (HTML/비정상 응답이면 throw)
   - 401/403이면 /admin/login 으로 보냄
========================= */
function useSafeJSON(navigate) {
  return async function safeJSON(promise) {
    try {
      const res = await promise;
      const ct = res?.headers?.["content-type"] || res?.headers?.get?.("content-type") || "";
      if (!res || !res.data || (typeof ct === "string" && ct.includes("text/html"))) {
        throw new Error("Invalid API response");
      }
      return res.data;
    } catch (err) {
      const status = err?.response?.status;
      const ct = err?.response?.headers?.["content-type"] || "";
      // HTML 응답은 경로 문제 가능성 → 콘솔 표시
      if (ct.includes("text/html")) {
        // eslint-disable-next-line no-console
        console.error("[AdminDashboard] HTML response from API:", err?.config?.url);
      }
      if (status === 401 || status === 403) {
        try {
          localStorage.removeItem("adminToken");
        } catch {}
        navigate("/admin/login", { replace: true });
      }
      throw err;
    }
  };
}

// ✅ 안전 기본값 도우미
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === "number" ? v : Number(v || 0));
const obj = (v) => (v && typeof v === "object" ? v : {});

export default function AdminDashboard() {
  const navigate = useNavigate(); // ✅ 네비게이션 훅 추가
  const safeJSON = useSafeJSON(navigate); // ✅ 응답 가드 래퍼

  // ✅ 상태 선언
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  // ✅ 학생 상세 모달 관련 상태
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [studentSchedule, setStudentSchedule] = useState({});

  // ✅ 설정 정보 상태 (여기서 잘못되어 있었음)
  const [settings, setSettings] = useState({
    week_range_text: "",
    external_desc: "",
    external_example: "",
    center_desc: "",
    center_example: "",
    notification_footer: ""
  });

  const fetchStudents = async () => {
    try {
      const data = await safeJSON(axiosInstance.get("/admin/students"));
      setStudents(arr(data) || []);
    } catch (err) {
      console.error("❌ 학생 목록 불러오기 실패:", err);
      alert("학생 목록을 불러오지 못했습니다.");
    }
  };

  useEffect(() => {
    fetchStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [schedules, setSchedules] = useState([]);
  const [newStudent, setNewStudent] = useState({
    id: "",
    name: "",
    grade: "현역",
    studentPhone: "",
    parentPhone: ""
  });
  const [searchText, setSearchText] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMode, setCalendarMode] = useState("");
  const [calendarEvents, setCalendarEvents] = useState([]);

  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [studentSchedules, setStudentSchedules] = useState([]);

  const openStudentDetail = (student) => {
    setSelectedStudent(student);
    setIsDetailModalOpen(true);
  };

  // ✅ 날짜 계산 함수 추가
  const getBaseDate = () => {
    const match = settings.week_range_text.match(/(\d+)\/(\d+)\s*~\s*(\d+)\/(\d+)/);
    if (!match) return new Date();
    const month = parseInt(match[1]) - 1;
    const day = parseInt(match[2]);
    return new Date(new Date().getFullYear(), month, day);
  };

  // ✅ 요일 매핑
  const dayMap = { "월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5 };

  // ✅ 인증 체크 강화
  useEffect(() => {
    const token = localStorage.getItem("adminToken");
    if (!token) {
      navigate("/admin/login");
      return; // ✅ 인증 없으면 API 요청도 중단
    }
  }, [navigate]);

  // ✅ 관리자 로그인 후 데이터 로딩
  useEffect(() => {
    const token = localStorage.getItem("adminToken");
    if (!token) {
      navigate("/admin/login");
      return;
    }

    const load = async () => {
      try {
        const [settingsData, studentsData, schedulesData] = await Promise.all([
          safeJSON(axiosInstance.get(`/admin/settings`, { params: { _t: Date.now() } })),
          safeJSON(axiosInstance.get(`/admin/students`, { params: { _t: Date.now() } })),
          safeJSON(axiosInstance.get(`/admin/schedules`, { params: { _t: Date.now() } })),
        ]);

        const newSettings  = obj(settingsData);
        const newStudents  = arr(studentsData);
        const newSchedules = arr(schedulesData);

        setSettings(newSettings);
        setStudents(newStudents);
        setSchedules(newSchedules);

        // ⬇️ 학생별 요약 재작성
        const byStudent = new Map();
        for (const s of newSchedules) {
          const a = byStudent.get(s.student_id) || [];
          a.push({ day: s.day, start: s.start, end: s.end, type: s.type });
          byStudent.set(s.student_id, a);
        }
        const nextStudentSchedules = newStudents.map((stu) => ({
          id: stu.id,
          completed: (byStudent.get(stu.id)?.length || 0) > 0,
          schedule: byStudent.get(stu.id) || [],
        }));
        setStudentSchedules(nextStudentSchedules);
        try { localStorage.setItem("studentSchedules", JSON.stringify(nextStudentSchedules)); } catch {}

        // ⬇️ 캘린더 이벤트 재생성
        const baseDate = getBaseDate();
        const evts = newSchedules
          .filter((it) => newStudents.some((s) => s.id === it.student_id))
          .map((it) => {
            const offset = dayMap[it.day] ?? 0;
            const date = new Date(baseDate);
            date.setDate(baseDate.getDate() + offset);
            const yyyyMMdd = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
            const studentName = newStudents.find((s) => s.id === it.student_id)?.name || it.student_id;
            return {
              title: `${studentName} ${it.start}~${it.end} (${it.type || ""})`,
              start: `${yyyyMMdd}T${it.start}`,
              end:   `${yyyyMMdd}T${it.end}`,
            };
          });
        setCalendarEvents(evts);
      } catch (err) {
        console.error("❌ 데이터 로드 실패:", err);
        const code = err?.response?.status;
        if (code === 401 || code === 403) {
          alert("인증이 만료되었습니다. 다시 로그인하세요.");
          try { localStorage.removeItem("adminToken"); } catch {}
          navigate("/admin/login");
        } else {
          alert("데이터 로드 중 오류가 발생했습니다.");
        }
      } finally {
        setLoading(false);
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  // ✅ 설정 변경
  const handleChange = (field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const saveSettings = async () => {
    try {
      const token = localStorage.getItem("adminToken");
      if (!token) {
        alert("관리자 인증이 필요합니다. 다시 로그인해주세요.");
        navigate("/admin/login");
        return;
      }

      // ✅ settings 저장 요청
      const res = await axiosInstance.put("/admin/settings", settings);

      // ✅ 서버가 돌려준 최신 settings로 상태 갱신
      if (res.data?.success) {
        if (res.data.settings) {
          setSettings(res.data.settings);
        } else {
          // 혹시 서버가 settings를 못 돌려줬으면, 한 번 더 GET
          const data = await safeJSON(axiosInstance.get(`/admin/settings`));
          setSettings(obj(data));
        }
        alert("✅ 설정이 저장되어 학생 페이지에 반영됩니다.");
      } else {
        alert(res.data?.error || "설정 저장 실패(알 수 없는 오류)");
      }
    } catch (err) {
      console.error("설정 저장 오류:", err);
      alert(
        `설정 저장 실패: ${err.response?.status || ""} ${err.response?.data?.error || err.message}`
      );
    }
  };

  // ✅ 랜덤 ID 생성
  const generateStudentId = () => {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    let id = "";
    for (let i = 0; i < 3; i++) id += letters[Math.floor(Math.random() * letters.length)];
    for (let i = 0; i < 3; i++) id += numbers[Math.floor(Math.random() * numbers.length)];
    setNewStudent((prev) => ({ ...prev, id }));
  };

  // ✅ 학생 등록 (디버그 로그 추가)
  const addStudent = async () => {
    const token = localStorage.getItem("adminToken");
    const { id, name, grade, studentPhone, parentPhone } = newStudent;

    // ⬇️ 디버그: 현재 입력값/토큰 확인
    console.log("[addStudent] token:", token);
    console.log("[addStudent] payload:", { id, name, grade, studentPhone, parentPhone });

    if (!id || !name) {
      alert("ID와 이름은 필수입니다.");
      return;
    }

    try {
      const res = await axiosInstance.post(
        `/admin/students`,
        { id, name, grade, studentPhone, parentPhone }
      );

      console.log("[addStudent] response:", res.status, res.data);

      if (res.data?.success) {
        alert("학생 등록 성공");

        const next = [...students, { id, name, grade, studentPhone, parentPhone }];
        setStudents(next);
        try { localStorage.setItem("students", JSON.stringify(next)); } catch {}

        setNewStudent({
          id: "",
          name: "",
          grade: "현역",
          studentPhone: "",
          parentPhone: "",
        });
      } else {
        alert(res.data?.error || "학생 등록 실패");
      }
    } catch (err) {
      // ⬇️ 디버그: 에러 상세 출력
      console.error("[addStudent] error:", err);
      console.log("[addStudent] error.status:", err.response?.status);
      console.log("[addStudent] error.data:", err.response?.data);

      const msg =
        err.response?.data?.error ||
        (err.response ? `서버 오류: ${err.response.status}` : "서버에 연결할 수 없습니다.");
      alert(`학생 등록 실패: ${msg}`);
    }
  };

  // ✅ 학생 삭제
  const deleteStudent = async (id) => {
    if (!window.confirm("정말 이 학생을 삭제하시겠습니까?")) return;

    try {
      await axiosInstance.delete(`/admin/students/${id}`);
      await fetchStudents(); // ✅ 목록을 서버 기준으로 재로딩
      alert("학생이 삭제되었습니다.");
    } catch (err) {
      console.error("학생 삭제 오류:", err);
      alert(err.response?.data?.error || "삭제 실패");
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm("⚠️ 정말 모든 학생 데이터를 삭제하시겠습니까?")) return;

    try {
      // 서버에 개별 삭제 요청 반복
      for (const s of students) {
        await axiosInstance.delete(`/admin/students/${s.id}`);
      }
      await fetchStudents(); // 최종 동기화
      try { localStorage.removeItem("students"); } catch {}
      alert("✅ 모든 학생 데이터가 삭제되었습니다.");
    } catch (err) {
      console.error("전체 삭제 오류:", err);
      alert(err.response?.data?.error || "전체 삭제 실패");
    }
  };

  // ✅ 학생 선택 시 일정 로드
  const handleStudentSelect = async (studentId) => {
    if (!studentId) {
      setCalendarEvents([]);
      return;
    }
    try {
      const data = await safeJSON(axiosInstance.get(`/student/schedule/${studentId}`));
      const list = arr(data);
      const baseDate = getBaseDate();
      const events = list.map((item) => {
        const offset = dayMap[item.day] ?? 0;
        const date = new Date(baseDate);
        date.setDate(baseDate.getDate() + offset);
        const yyyyMMdd = `${date.getFullYear()}-${(date.getMonth() + 1)
          .toString()
          .padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
        return {
          title: `${item.start}~${item.end} (${item.type || ""})`,
          start: `${yyyyMMdd}T${item.start}`,
          end: `${yyyyMMdd}T${item.end}`,
        };
      });
      setCalendarEvents(events);
    } catch (err) {
      console.error("❌ 학생 일정 불러오기 실패:", err);
      alert("학생 일정 로드에 실패했습니다.");
    }
  };

  // ✅ 학생 상세 모달 열기
  const openDetailModal = async (student) => {
    try {
      // ⛔ 기존: "/api/admin/student-schedules" → 잘못된 이중 /api
      // ✅ 수정: axiosInstance 기준 상대경로 사용
      const data = await safeJSON(axiosInstance.get("/admin/student-schedules"));
      const allSchedules = arr(data);
      const studentSchedules = allSchedules.filter((s) => s.student_id === student.id);

      const updatedStudent = {
        ...student,
        schedules: studentSchedules,
      };

      setSelectedStudent(updatedStudent);
      setShowDetailModal(true);
    } catch (err) {
      console.error("❌ 일정 불러오기 실패:", err?.message);
      alert("해당 학생의 일정을 불러오는 데 실패했습니다.");
    }
  };

  // ✅ 모달 닫기
  const closeStudentDetail = () => {
    setSelectedStudent(null);
    setIsDetailModalOpen(false);
  };

  // ✅ 문자 발송 함수 (학생 / 보호자 선택 가능)
  const sendSmsNotification = async (student, type = "student") => {
    const phoneNumber = type === "student" ? student.studentPhone : student.parentPhone;

    if (!phoneNumber) {
      alert(type === "student" ? "학생 전화번호가 없습니다." : "보호자 전화번호가 없습니다.");
      return;
    }

    const target = studentSchedules.find((s) => s.id === student.id);
    if (!target || !target.completed) {
      alert("일정이 입력되지 않았습니다.");
      return;
    }

    // ✅ 메시지 구성
    let message = `[안내] ${student.name}님의 이번 주 일정\n`;
    target.schedule.forEach((item) => {
      message += `${item.day}: ${item.start} ~ ${item.end} (${item.type})\n`;
    });

    if (settings.notification_footer) {
      message += `\n${settings.notification_footer}`;
    }

    try {
      const response = await axiosInstance.post(`/sms/send`, {
        to: phoneNumber,
        text: message,
      });

      if (response.data.success) {
        alert(`✅ 문자 발송 성공!\n\n대상: ${phoneNumber}\n\n${message}`);
      } else {
        alert(`❌ 문자 발송 실패: ${response.data.error}`);
      }
    } catch (error) {
      console.error("❌ 문자 발송 오류:", error);
      alert("서버 오류로 문자 발송에 실패했습니다.");
    }
  };

  // ✅ 이름 정렬 상태 (Hook은 최상단에서만 선언!)
  const [nameSort, setNameSort] = useState('asc');

  // ✅ 높이 자동 맞춤 (검색창 ↔ Delete All 버튼)
  useEffect(() => {
    const syncHeights = () => {
      const input = document.querySelector('input[placeholder="학생 이름 검색"]');
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => (b.textContent || "").trim() === "Delete All"
      );
      if (input && btn) {
        const h = Math.max(input.offsetHeight, btn.offsetHeight);
        input.style.height = `${h}px`;
        btn.style.height = `${h}px`;
      }
    };
    syncHeights();
    window.addEventListener("resize", syncHeights);
    return () => window.removeEventListener("resize", syncHeights);
  }, []);

  if (loading) return <div className="p-4 text-center text-lg">⏳ 데이터 로딩 중...</div>;

  // ✅ 검색 + 정렬 적용된 학생 목록
  const filteredStudents = students
    .filter((s) => (s.name || "").toLowerCase().includes(searchText.toLowerCase()))
    .sort((a, b) => {
      if (nameSort === 'none') return 0;
      const cmp = (a.name || "").localeCompare((b.name || ""), 'ko');
      return nameSort === 'asc' ? cmp : -cmp;
    });

  const refreshSchedules = async () => {
    try {
      const token = localStorage.getItem("adminToken");
      if (!token) {
        alert("관리자 인증이 필요합니다.");
        navigate("/admin/login");
        return;
      }

      const data = await safeJSON(axiosInstance.get("/admin/studentschedules"));
      const latestStudents = arr(data.students);
      const latestSchedules = arr(data.schedules);

      // ✅ 이 두 줄이 가장 중요
      setStudents(latestStudents);
      setSchedules(latestSchedules);

      // ✅ 캘린더 이벤트 생성
      const baseDate = getBaseDate();
      const newEvents = latestSchedules
        .filter((it) => latestStudents.some((s) => s.id === it.student_id))
        .map((it) => {
          const offset = dayMap[it.day] ?? 0;
          const d = new Date(baseDate);
          d.setDate(baseDate.getDate() + offset);
          const yyyyMMdd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          const studentName = latestStudents.find((s) => s.id === it.student_id)?.name || it.student_id;
          return {
            title: `${studentName} ${it.start}~${it.end} (${it.type || ""})`,
            start: `${yyyyMMdd}T${it.start}`,
            end:   `${yyyyMMdd}T${it.end}`,
          };
        });

      setCalendarEvents(newEvents);
      alert("✅ 일정이 최신화되었습니다!");
    } catch (err) {
      console.error("❌ 일정 최신화 실패:", err);
      const code = err?.response?.status;
      if (code === 401 || code === 403) {
        alert("세션이 만료되었습니다. 다시 로그인하세요.");
        try { localStorage.removeItem("adminToken"); } catch {}
        navigate("/admin/login");
      } else {
        alert("일정 최신화 실패");
      }
    }
  };

  // ✅ 파일명 prefix 구성: 주차 텍스트가 있으면 YYYYMMDD-YYYYMMDD 붙임
  const buildFilenamePrefix = (base) => {
    const txt = settings?.week_range_text || "";
    const m = txt.match(/(\d{1,2})\/(\d{1,2})\s*~\s*(\d{1,2})\/(\d{1,2})/);
    if (m) {
      const yyyy = new Date().getFullYear();
      const s = `${yyyy}${m[1].padStart(2, "0")}${m[2].padStart(2, "0")}`;
      const e = `${yyyy}${m[3].padStart(2, "0")}${m[4].padStart(2, "0")}`;
      return `${base}_${s}-${e}`;
    }
    return base;
  };

  const handleExportExternalExcel = () => {
    // 스케줄이 없어도 '템플릿'을 받고 싶을 수 있으니 일정 유무 체크는 제거/완화
    exportExternalSchedulesToExcel(
      schedules || [],
      students || [],
      buildFilenamePrefix("외부일정"),
      {
        rangeText: settings?.week_range_text || "",
        includeSunday: true, // 일요일 열 포함을 원치 않으면 false
      }
    );
  };

  const handleExportCenterExcel = () => {
    exportCenterSchedulesToExcel(
      schedules || [],
      students || [],
      buildFilenamePrefix("센터일정"),
      {
        rangeText: settings?.week_range_text || "",
        includeSunday: true, // 일요일 포함 여부
      }
    );
  };

  // ✅ 전체 저장 함수 추가
  const handleSaveAll = () => {
    const dataToSave = {
      students,
      settings,
      schedules,
      calendarEvents,
      studentSchedules
    };

    const blob = new Blob([JSON.stringify(dataToSave, null, 2)], {
      type: "application/json"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "admin_dashboard_backup.json";
    link.click();
    URL.revokeObjectURL(url);

    alert("✅ 모든 데이터가 파일로 저장되었습니다.");
  };

  // ⬇️⬇️ 파일 불러오기 (JSON/Excel 통합) ---------------------------------
  const handleFileImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (ext === "json") {
      handleLoadJson(file);
    } else if (ext === "xlsx" || ext === "xls") {
      handleLoadExcel(file);
    } else {
      alert("지원하지 않는 파일 형식입니다. .json, .xlsx, .xls 만 가능합니다.");
    }
    // 같은 파일 재업로드 가능하도록 value 초기화
    e.target.value = "";
  };

  // 기존 JSON 로더의 본문은 handleLoadJson으로 옮깁니다(아래 4번 참조).
  const handleLoadJson = (file) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.students) setStudents(data.students);
        if (data.settings) setSettings(data.settings);
        if (data.schedules) setSchedules(data.schedules);
        if (data.calendarEvents) setCalendarEvents(data.calendarEvents);
        if (data.studentSchedules) setStudentSchedules(data.studentSchedules);

        try {
          localStorage.setItem("students", JSON.stringify(data.students || []));
          localStorage.setItem("studentSchedules", JSON.stringify(data.studentSchedules || []));
        } catch {}
        alert("✅ JSON 데이터가 성공적으로 복원되었습니다!");
      } catch (error) {
        alert("❌ JSON 파일을 불러오는 중 오류가 발생했습니다.");
        console.error(error);
      }
    };
    reader.readAsText(file);
  };

  // Excel 전용 파서
  const handleLoadExcel = (file) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "binary" });

        // 파싱 결과 누적
        const nextStudents = new Map();
        const schedulesExternal = [];
        const schedulesCenter = [];

        // 기존 학생을 미리 반영(병합용)
        for (const s of students || []) {
          nextStudents.set(s.name || s.studentPhone || s.id, { ...s });
        }

        wb.SheetNames.forEach((sheetName) => {
          const ws = wb.Sheets[sheetName];
          if (!ws) return;

          const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          if (!json || json.length < 2) return;

          // A1 제목 → 주차 텍스트 추출
          const a1 = (json[0]?.[0] || "").toString();
          const rangeTxt = extractRangeTextFromTitle(a1);
          if (rangeTxt) {
            setSettings((prev) => ({ ...prev, week_range_text: rangeTxt }));
          }

          // A2 헤더
          const header = json[1] || [];
          const cName = header.indexOf("이름");
          const cSeat = header.indexOf("좌석번호");
          const cPhone = header.indexOf("전화번호");
          const dayCols = {};
          ["월", "화", "수", "목", "금", "토", "일"].forEach((d) => {
            const idx = header.indexOf(d);
            if (idx !== -1) dayCols[d] = idx;
          });

          const isExternal = /외부/.test(sheetName) || /외부/.test(a1);
          const isCenter = /센터/.test(sheetName) || /센터/.test(a1);

          for (let r = 2; r < json.length; r++) {
            const row = json[r];
            if (!row) continue;

            const name = (row[cName] || "").toString().trim();
            const seatNumber = (cSeat !== -1 ? row[cSeat] : "").toString().trim();
            const phone = (cPhone !== -1 ? row[cPhone] : "").toString().trim();

            if (!name && !phone) continue;

            const key = name || phone;
            const existing = nextStudents.get(key);
            const id = existing?.id || generateStudentIdLocal();

            const mergedStudent = {
              id,
              name: name || existing?.name || "",
              grade: existing?.grade || "현역",
              studentPhone: phone || existing?.studentPhone || "",
              parentPhone: existing?.parentPhone || "",
              seatNumber: seatNumber || existing?.seatNumber || "",
            };
            nextStudents.set(key, mergedStudent);

            Object.entries(dayCols).forEach(([dayK, colIdx]) => {
              const cell = (row[colIdx] || "").toString().trim();
              if (!cell) return;

              const ranges = parseTimeRanges(cell);
              ranges.forEach(({ start, end, desc }) => {
                const base = { student_id: id, day: dayK, start, end };
                if (isExternal) {
                  schedulesExternal.push({ ...base, type: "외부", description: desc || "" });
                } else if (isCenter) {
                  schedulesCenter.push({ ...base, type: "센터" });
                }
              });
            });
          }
        });

        const mergedStudentsArr = Array.from(nextStudents.values());
        setStudents(mergedStudentsArr);

        const nextSchedules = [...schedulesExternal, ...schedulesCenter];
        setSchedules(nextSchedules);

        // ⬇️ 학생별 상세 모달에서 쓰는 구조로도 채워 넣기
        const mapByStudent = new Map();
        for (const sch of nextSchedules) {
          const a = mapByStudent.get(sch.student_id) || [];
          a.push({ day: sch.day, start: sch.start, end: sch.end, type: sch.type });
          mapByStudent.set(sch.student_id, a);
        }
        const nextStudentSchedules = mergedStudentsArr.map((s) => ({
          id: s.id,
          completed: (mapByStudent.get(s.id)?.length || 0) > 0,
          schedule: mapByStudent.get(s.id) || [],
        }));
        setStudentSchedules(nextStudentSchedules);

        // 저장
        try {
          localStorage.setItem("students", JSON.stringify(mergedStudentsArr));
          localStorage.setItem("studentSchedules", JSON.stringify(nextStudentSchedules));
        } catch {}

        alert("✅ 엑셀 데이터가 성공적으로 반영되었습니다!");

      } catch (err) {
        console.error("엑셀 파싱 오류:", err);
        alert("❌ 엑셀 파일을 불러오는 중 오류가 발생했습니다. 템플릿 형식을 확인해주세요.");
      }
    };
    reader.readAsBinaryString(file);
  };

  // A1 제목에서 괄호 안 주차 텍스트 추출
  function extractRangeTextFromTitle(titleCellText) {
    if (!titleCellText) return "";
    const m = String(titleCellText).match(/\((\d{1,2}\/\d{1,2}\s*~\s*\d{1,2}\/\d{1,2})\)/);
    return m ? m[1] : "";
  }

  // "08:00~12:00, 13:00~17:00(설명)" → 배열로
  function parseTimeRanges(cellText) {
    const text = String(cellText || "");

    // 쉼표/세미콜론/全角세미콜론/슬래시/개행 등으로 끊어서 각각 처리
    const parts = text
      .split(/[,，;；\/\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const out = [];
    // “08:00~17:00(설명)” / “08.00～22.00” / “8:0 - 22:10” 등 모두 허용
    const RANGE_RE = /(\d{1,2}[:.]\d{1,2})\s*(?:~|∼|～|-)\s*(\d{1,2}[:.]\d{1,2})(?:\s*\(([^)]+)\))?/;

    for (const p of parts) {
      const m = p.match(RANGE_RE);
      if (!m) continue;
      const start = normalizeTime(m[1]);
      const end   = normalizeTime(m[2]);
      const desc  = (m[3] || "").trim();
      if (!start || !end) continue;
      out.push({ start, end, desc });
    }
    return out;
  }

  // "8:0" → "08:00"
  function normalizeTime(hhmm) {
    const m = String(hhmm).match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return "";
    const h = String(Math.min(23, Number(m[1]))).padStart(2, "0");
    const min = String(Math.min(59, Number(m[2]))).padStart(2, "0");
    return `${h}:${min}`;
  }

  // 간단 랜덤 ID
  function generateStudentIdLocal() {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    let id = "";
    for (let i = 0; i < 3; i++) id += letters[Math.floor(Math.random() * letters.length)];
    for (let i = 0; i < 3; i++) id += numbers[Math.floor(Math.random() * numbers.length)];
    return id;
  }
  // ⬆️⬆️ 파일 불러오기 (JSON/Excel 통합) ---------------------------------

  // ✅ 전체 불러오기 함수 추가
  const handleLoadAll = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);

        if (data.students) setStudents(data.students);
        if (data.settings) setSettings(data.settings);
        if (data.schedules) setSchedules(data.schedules);
        if (data.calendarEvents) setCalendarEvents(data.calendarEvents);
        if (data.studentSchedules) setStudentSchedules(data.studentSchedules);

        // ✅ LocalStorage에도 저장
        try {
          localStorage.setItem("students", JSON.stringify(data.students || []));
          localStorage.setItem("studentSchedules", JSON.stringify(data.studentSchedules || []));
        } catch {}

        alert("✅ 데이터가 성공적으로 복원되었습니다!");
      } catch (error) {
        alert("❌ 파일을 불러오는 중 오류가 발생했습니다.");
        console.error(error);
      }
    };
    reader.readAsText(file);
  };

  // ✅ 캘린더 모달 열기 함수
  const openCalendar = (mode) => {
    setCalendarMode(mode);
    setCalendarOpen(true);

    if (mode === "center") {
      // ✅ 기존 유지
      const attendanceData = JSON.parse(localStorage.getItem("attendance") || "[]");
      const events = [];
      Object.keys(attendanceData).forEach((studentId) => {
        const studentName = students.find((s) => s.id === studentId)?.name || "";
        attendanceData[studentId].forEach((record) => {
          events.push({
            title: `${studentName} ${record.start}-${record.end}`,
            start: record.date
          });
        });
      });
      setCalendarEvents(events);
    } else {
      // ✅ 추가: DB 스케줄 데이터를 FullCalendar 이벤트로 변환
      const baseDate = getBaseDate();
      const events = schedules.map((item) => {
        const offset = dayMap[item.day] ?? 0;
        const date = new Date(baseDate);
        date.setDate(baseDate.getDate() + offset);
        const yyyyMMdd = `${date.getFullYear()}-${(date.getMonth() + 1)
          .toString()
          .padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
        const studentName = students.find((s) => s.id === item.student_id)?.name || item.student_id;
        return {
          title: `${studentName} ${item.start}~${item.end} (${item.type || ""})`,
          start: `${yyyyMMdd}T${item.start}`,
          end: `${yyyyMMdd}T${item.end}`
        };
      });
      setCalendarEvents(events);
    }
  };

  // ✅ 학생 선택 시 일정 로드
  const handleCenterCalendarClick = () => {
    setCalendarMode("center");
    const events = schedules.map((sch) => {
      const offset = dayMap[sch.day] ?? 0;
      const baseDate = getBaseDate();
      const date = new Date(baseDate);
      date.setDate(baseDate.getDate() + offset);
      const yyyyMMdd = `${date.getFullYear()}-${(date.getMonth() + 1)
        .toString()
        .padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
      return {
        title: `${sch.name} (${sch.start}~${sch.end})`,
        start: `${yyyyMMdd}T${sch.start}`,
        end: `${yyyyMMdd}T${sch.end}`,
        memo: sch.description || "",
      };
    });
    setCalendarEvents(events);
    setCalendarOpen(true); // ✅ 수정: 잘못된 setIsCalendarOpen → setCalendarOpen
  };

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">관리자 페이지</h1>

      <div className="flex gap-4 mb-6">
        <button
          onClick={() => openCalendar("student")}
          className="bg-blue-500 text-white px-4 py-2 rounded"
        >
          학생 별 일정표(캘린더)
        </button>
        <button
          onClick={handleCenterCalendarClick}
          className="bg-green-500 text-white px-4 py-2 rounded"
        >
          센터 재원 시간(캘린더)
        </button>

        {/* ✅ 일정 최신화 */}
        <button
          onClick={refreshSchedules}
          className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600"
        >
          학생일정 최신화
        </button>

        {/* ⬇️⬇️ 추가: 엑셀 다운로드 두 가지 */}
        <button
          onClick={handleExportExternalExcel}
          className="bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700"
        >
          외부 일정 엑셀
        </button>
        <button
          onClick={handleExportCenterExcel}
          className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
        >
          센터 일정 엑셀
        </button>
        {/* ⬆️⬆️ 추가 끝 */}

        {/* ✅ 전체 저장 */}
        <button
          onClick={handleSaveAll}
          className="bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600"
        >
          전체 저장
        </button>

        {/* ✅ 불러오기 */}
        <input
          type="file"
          accept=".json,.xlsx,.xls"
          onChange={handleFileImport}
          className="border px-2 py-1"
        />
      </div>

      {/* ✅ Calendar Modal */}
      <CalendarModal
        isOpen={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        mode={calendarMode}
        students={students}
        events={calendarEvents}
        onStudentSelect={handleStudentSelect}
      />

      {/* ✅ 학생 등록 */}
      <div className="border p-4 mb-6 rounded bg-gray-50">
        <h2 className="text-lg font-semibold mb-3">학생 등록</h2>
        <div className="grid grid-cols-6 gap-4 mb-3">
          <input
            type="text"
            placeholder="학생 ID (직접 입력 가능)"
            value={newStudent.id}
            onChange={(e) => setNewStudent({ ...newStudent, id: e.target.value })}
            className="border p-2 rounded"
          />
          <button onClick={generateStudentId} className="bg-gray-400 text-white px-2 py-2 rounded">
            랜덤 ID
          </button>
          <input
            type="text"
            placeholder="이름"
            value={newStudent.name}
            onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })}
            className="border p-2 rounded"
          />
          <select
            value={newStudent.grade}
            onChange={(e) => setNewStudent({ ...newStudent, grade: e.target.value })}
            className="border p-2 rounded"
          >
            <option>현역</option>
            <option>N수</option>
          </select>
          <input
            type="text"
            placeholder="학생 전화번호"
            value={newStudent.studentPhone}
            onChange={(e) => setNewStudent({ ...newStudent, studentPhone: e.target.value })}
            className="border p-2 rounded"
          />
          <input
            type="text"
            placeholder="보호자 전화번호"
            value={newStudent.parentPhone}
            onChange={(e) => setNewStudent({ ...newStudent, parentPhone: e.target.value })}
            className="border p-2 rounded"
          />
        </div>
        <button onClick={addStudent} className="bg-green-500 text-white px-4 py-2 rounded">
          학생 등록
        </button>
      </div>

      {/* ✅ 검색창 + 전체 삭제 버튼 */}
      <div className="flex justify-between mb-4">
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="학생 이름 검색"
          className="border border-gray-350 px-2 py-1 mb-2 rounded w-full"
        />
        <button
          onClick={handleDeleteAll}
          className="bg-red-500 text-white px-10 py-1 rounded hover:bg-red-600"
        >Delete All
        </button>
      </div>

      {/* ✅ 이름 정렬 버튼 */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm text-gray-600">정렬:</span>
        <button onClick={() => setNameSort('asc')}  className={`px-3 py-1 rounded border ${nameSort==='asc' ? 'bg-gray-800 text-white' : 'bg-white'}`}>이름(가나다)</button>
        <button onClick={() => setNameSort('desc')} className={`px-3 py-1 rounded border ${nameSort==='desc' ? 'bg-gray-800 text-white' : 'bg-white'}`}>이름(역순)</button>
        <button onClick={() => setNameSort('none')} className={`px-3 py-1 rounded border ${nameSort==='none' ? 'bg-gray-800 text-white' : 'bg-white'}`}>정렬 해제</button>
      </div>

      {/* ✅ 학생 리스트 */}
      <h2 className="text-xl font-semibold mb-2">등록된 학생</h2>
      <table className="table-auto w-full border mb-6">
        <thead>
          <tr className="bg-gray-200 text-center">
            <th className="border px-2 py-1">ID</th>
            <th className="border px-2 py-1">이름</th>
            <th className="border px-2 py-1">학년</th>
            <th className="border px-2 py-1">학생전화</th>
            <th className="border px-2 py-1">보호자전화</th>
            <th className="border px-2 py-1">상세</th>
            <th className="border px-2 py-1">문자</th>
            <th className="border px-2 py-1">삭제</th>
          </tr>
        </thead>
        <tbody>
          {filteredStudents.map((s, idx) => (
            <tr key={idx} className="text-center">
              <td className="border px-2 py-1">{s.id}</td>
              <td className="border px-2 py-1">{s.name}</td>
              <td className="border px-2 py-1">{s.grade}</td>
              <td className="border px-2 py-1">{s.studentPhone}</td>
              <td className="border px-2 py-1">{s.parentPhone}</td>
              <td className="border px-2 py-1">
                <button
                  onClick={() => openStudentDetail(s)}
                  className="bg-blue-500 text-white px-2 py-1 rounded"
                >
                  상세
                </button>
              </td>
              <td className="border px-2 py-1">
                <button
                  onClick={() => sendSmsNotification(s, "student")}
                  className="bg-green-500 text-white px-2 py-1 rounded mr-1 hover:bg-green-600"
                >
                  학  생
                </button>
                <button
                  onClick={() => sendSmsNotification(s, "parent")}
                  className="bg-blue-500 text-white px-2 py-1 rounded mr-1 hover:bg-blue-600"
                >
                  보호자
                </button>
                <button
                  onClick={async () => {
                    await sendSmsNotification(s, "student");
                    await sendSmsNotification(s, "parent");
                  }}
                  className="bg-purple-500 text-white px-2 py-1 rounded hover:bg-purple-600"
                >
                  전  체
                </button>
              </td>
              <td className="border px-2 py-1">
                <button
                  onClick={() => deleteStudent(s.id)}
                  className="bg-red-500 text-white px-2 py-1 rounded"
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ✅✅ 추가 섹션: 학생별 센터 재원 시간 요약 (요일/날짜 + 미등원 표시) */}
      <div className="border p-4 mb-6 rounded">
        <h2 className="text-lg font-semibold mb-3">학생별 센터 재원 요약</h2>
        <CenterSummaryTable
          students={students}
          schedules={schedules}
          weekRangeText={settings?.week_range_text || ""}
        />
      </div>

      {/* ✅✅ 추가 섹션: 학생별 ‘첫 등원 시간’ 요약 */}
      <div className="border p-4 mb-6 rounded">
        <h2 className="text-lg font-semibold mb-3">학생별 첫 등원 시간</h2>
        <FirstArrivalTable
          students={students}
          schedules={schedules}
          weekRangeText={settings?.week_range_text || ""}
        />
      </div>

      <div className="border p-4 mb-6 rounded">
        <h2 className="text-lg font-semibold mb-2">페이지 설정</h2>
        <div className="grid grid-cols-2 gap-4">
          <input
            type="text"
            placeholder="이번 주 범위 (예: 7/19~7/24)"
            value={settings.week_range_text}
            onChange={(e) => handleChange("week_range_text", e.target.value)}
            className="border p-2 rounded"
          />
          <input
            type="text"
            placeholder="외부 일정 설명"
            value={settings.external_desc}
            onChange={(e) => handleChange("external_desc", e.target.value)}
            className="border p-2 rounded"
          />
          <input
            type="text"
            placeholder="외부 일정 예시"
            value={settings.external_example}
            onChange={(e) => handleChange("external_example", e.target.value)}
            className="border p-2 rounded"
          />
          <input
            type="text"
            placeholder="센터 일정 설명"
            value={settings.center_desc}
            onChange={(e) => handleChange("center_desc", e.target.value)}
            className="border p-2 rounded"
          />
          <input
            type="text"
            placeholder="센터 일정 예시"
            value={settings.center_example}
            onChange={(e) => handleChange("center_example", e.target.value)}
            className="border p-2 rounded"
          />
          <textarea
            placeholder="카카오 알림 푸터 메시지 입력"
            value={settings.notification_footer}
            onChange={(e) => handleChange("notification_footer", e.target.value)}
            className="border p-2 rounded col-span-2"
            rows={3}
          />
        </div>
        <button
          onClick={saveSettings}
          className="bg-blue-500 text-white px-4 py-2 rounded mt-4"
        >
          설정 저장
        </button>
      </div>

      {/* ✅ 학생 상세 모달 (조건부) */}
      {isDetailModalOpen && selectedStudent && (
        <StudentDetailModal
          isOpen={isDetailModalOpen}
          onClose={closeStudentDetail}
          student={selectedStudent}
          schedules={studentSchedules.find((s) => s.id === selectedStudent.id)}
          settings={settings}
          // ⬇️ 서버에 반영되도록 수정
          onUpdateStudent={async (updated) => {
            try {
              await axiosInstance.put(`/admin/students/${updated.id}`, {
                name: updated.name ?? "",
                grade: updated.grade ?? "",
                studentPhone: updated.studentPhone ?? "",
                parentPhone: updated.parentPhone ?? "",
              });

              const updatedList = students.map((s) =>
                s.id === updated.id ? { ...s, ...updated }
              : s
              );
              setStudents(updatedList);
              try { localStorage.setItem("students", JSON.stringify(updatedList)); } catch {}
              alert("✅ 서버에 학생 정보가 저장되었습니다.");
            } catch (err) {
              console.error("학생 정보 저장 오류:", err);
              alert("❌ 학생 정보를 저장하지 못했습니다.");
            }
          }}
          onSendSms={sendSmsNotification}
        />
      )}
    </div>
  );
} // 컴포넌트 끝


/* =========================
   ⬇⬇ 보조 함수/컴포넌트 (추가)
   ========================= */

// 주차 텍스트("8/11~8/16")에서 월~일 날짜 라벨 생성
function getWeekDateLabels(rangeText = "") {
  const m = String(rangeText).match(/(\d{1,2})\/(\d{1,2})\s*~\s*(\d{1,2})\/(\d{1,2})/);
  if (!m) return ["", "", "", "", "", "", ""];
  const year = new Date().getFullYear();
  const start = new Date(year, Number(m[1]) - 1, Number(m[2]));
  const labels = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
  }
  return labels;
}

// ✅ (기존 유지) schedules에서 type==="센터"만 모아 학생/요일별로 "HH:MM~HH:MM, ..." 문자열 생성
function buildCenterSummaryRows(students = [], schedules = []) {
  const dayOrder = ["월", "화", "수", "목", "금", "토", "일"];
  const map = new Map();

  (schedules || [])
    .filter((it) => (it.type || "") === "센터")
    .forEach((it) => {
      const sid = it.student_id;
      if (!map.has(sid)) map.set(sid, {});
      const byDay = map.get(sid);
      if (!byDay[it.day]) byDay[it.day] = [];
      byDay[it.day].push({ s: it.start, e: it.end });
    });

  function mergeRanges(ranges) {
    if (!ranges || !ranges.length) return "";
    const toMin = (t) => {
      const [H, M] = String(t).split(":").map((n) => parseInt(n, 10));
      return H * 60 + M;
    };
    const fromMin = (m) =>
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

    const arr = ranges
      .map((r) => ({ s: toMin(r.s), e: toMin(r.e) }))
      .filter((r) => r.s < r.e)
      .sort((a, b) => a.s - b.s);

    const merged = [];
    for (const cur of arr) {
      if (!merged.length || merged[merged.length - 1].e < cur.s) merged.push({ ...cur });
      else merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, cur.e);
    }
    return merged.map((r) => `${fromMin(r.s)}~${fromMin(r.e)}`).join(", ");
  }

  return (students || []).map((stu) => {
    const row = { id: stu.id, name: stu.name || stu.id };
    const byDay = map.get(stu.id) || {};
    dayOrder.forEach((d) => {
      row[d] = mergeRanges(byDay[d]);
    });
    return row;
  });
}

/* ✅ 새로 추가: 센터 집계 + '미등원' 자동 반영 + 첫 등원 시간 계산 */
function buildCenterAggWithAbsent(students = [], schedules = []) {
  const dayOrder = ["월", "화", "수", "목", "금", "토", "일"];

  // 미등원 표시 세트 (type이 '미등원' 이거나 description에 '미등원' 포함 시)
  const absentSet = new Set();
  (schedules || []).forEach((it) => {
    const t = (it.type || "").trim();
    const desc = (it.description || "").trim();
    if (t === "미등원" || /미등원/.test(desc)) {
      absentSet.add(`${it.student_id}::${it.day}`);
    }
  });

  // 학생/요일별 센터 구간
  const centerBy = new Map();
  (schedules || [])
    .filter((it) => (it.type || "") === "센터")
    .forEach((it) => {
      const sid = it.student_id;
      if (!centerBy.has(sid)) centerBy.set(sid, {});
      const byDay = centerBy.get(sid);
      if (!byDay[it.day]) byDay[it.day] = [];
      byDay[it.day].push({ start: it.start, end: it.end });
    });

  // 유틸
  const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(":").map((n) => parseInt(n, 10));
    return h * 60 + m;
  };
  const fromMin = (mm) => `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;

  // 결과
  const rows = [];
  const firstArrivals = []; // [{id,name, 월: "11:00" | "미등원" | "" ...}]

  (students || []).forEach((stu) => {
    const sid = stu.id;
    const byDay = centerBy.get(sid) || {};
    const row = { id: sid, name: stu.name || sid };          // 전체 구간 표시용
    const firstRow = { id: sid, name: stu.name || sid };      // 첫 등원 표시용

    dayOrder.forEach((d) => {
      // 미등원 우선
      if (absentSet.has(`${sid}::${d}`)) {
        row[d] = "미등원";
        firstRow[d] = "미등원";
        return;
      }
      const blocks = (byDay[d] || []).slice();

      if (!blocks.length) {
        row[d] = "";
        firstRow[d] = "";
        return;
      }

      // 병합해서 문자열 생성
      const sorted = blocks
        .map((b) => ({ s: toMin(b.start), e: toMin(b.end) }))
        .filter((b) => b.s < b.e)
        .sort((a, b) => a.s - b.s);

      const merged = [];
      for (const cur of sorted) {
        if (!merged.length || merged[merged.length - 1].e < cur.s) merged.push({ ...cur });
        else merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, cur.e);
      }
      row[d] = merged.map((m) => `${fromMin(m.s)}~${fromMin(m.e)}`).join(", ");

      // 첫 등원(가장 이른 시작)
      firstRow[d] = fromMin(sorted[0].s);
    });

    rows.push(row);
    firstArrivals.push(firstRow);
  });

  return { rows, firstArrivals, absentSet };
}

// 요약 표 (미등원 버튼은 '숨김' 처리)
function CenterSummaryTable({ students, schedules, weekRangeText }) {
  // 기존 로직 보존(사용은 안 해도 유지)
  const rowsLegacy = buildCenterSummaryRows(students, schedules);

  // 새 집계(미등원 자동 반영)
  const { rows, absentSet } = buildCenterAggWithAbsent(students, schedules);

  const dateLabels = getWeekDateLabels(weekRangeText);
  const dayOrder = ["월", "화", "수", "목", "금", "토", "일"];

  // 👉 기존 코드 유지용(버튼을 없애달라 했지만, '삭제'하지 않고 숨김 처리)
  const SHOW_MANUAL_ABSENT_BUTTON = false;

  return (
    <div className="overflow-auto">
      <table className="table-auto w-full border">
        <thead>
          <tr className="bg-gray-200 text-center">
            <th className="border px-2 py-1 w-24">ID</th>
            <th className="border px-2 py-1 w-28">이름</th>
            {dayOrder.map((d, idx) => (
              <th key={d} className="border px-2 py-1">
                {d}{dateLabels[idx] ? `(${dateLabels[idx]})` : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(rows.length ? rows : rowsLegacy).map((r) => (
            <tr key={r.id} className="text-center align-top">
              <td className="border px-2 py-1">{r.id}</td>
              <td className="border px-2 py-1">{r.name}</td>
              {dayOrder.map((d) => {
                const isAbsentAuto = r[d] === "미등원" || absentSet.has(`${r.id}::${d}`);
                const cellText = r[d] || "";
                return (
                  <td key={d} className="border px-2 py-1">
                    <div className={`min-h-[2.25rem] ${isAbsentAuto ? "text-red-600 font-semibold" : ""}`}>
                      {isAbsentAuto ? "미등원" : (cellText || <span className="text-gray-400">—</span>)}
                    </div>
                    {/* 기존 '미등원' 토글 버튼은 삭제하지 않고 숨김 처리 */}
                    <button
                      type="button"
                      className={`${SHOW_MANUAL_ABSENT_BUTTON ? "" : "hidden"} mt-1 px-4 py-2 rounded text-sm border`}
                      title="해당 요일 미등원 표시 (저장 데이터에는 영향 없음)"
                    >
                      미등원
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-500 mt-2">
        * 표는 학생이 입력한 <b>센터</b> 시간만 반영됩니다. “미등원”은 학생 입력을 기준으로 자동 표시됩니다.
      </p>
    </div>
  );
}

/* ✅ 새 섹션: 학생별 '첫 등원 시간' 표 */
function FirstArrivalTable({ students, schedules, weekRangeText }) {
  const { firstArrivals, absentSet } = buildCenterAggWithAbsent(students, schedules);
  const dayOrder = ["월", "화", "수", "목", "금", "토", "일"];
  const dateLabels = getWeekDateLabels(weekRangeText);

  return (
    <div className="overflow-auto">
      <table className="table-auto w-full border">
        <thead>
          <tr className="bg-gray-200 text-center">
            <th className="border px-2 py-1 w-24">ID</th>
            <th className="border px-2 py-1 w-28">이름</th>
            {dayOrder.map((d, idx) => (
              <th key={d} className="border px-2 py-1">
                {d}{dateLabels[idx] ? `(${dateLabels[idx]})` : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {firstArrivals.map((r) => (
            <tr key={r.id} className="text-center">
              <td className="border px-2 py-1">{r.id}</td>
              <td className="border px-2 py-1">{r.name}</td>
              {dayOrder.map((d) => {
                const isAbsent = r[d] === "미등원" || absentSet.has(`${r.id}::${d}`);
                const val = r[d];
                return (
                  <td key={d} className="border px-2 py-1">
                    {isAbsent ? (
                      <span className="text-red-600 font-semibold">미등원</span>
                    ) : (
                      <span className="">{val || <span className="text-gray-400">—</span>}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-500 mt-2">
        * 각 요일에 가장 이른 센터 입실 시각만 표시합니다. 미등원일은 “미등원”으로 표기됩니다.
      </p>
    </div>
  );
}
