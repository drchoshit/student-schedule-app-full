// frontend/src/pages/AdminDashboard.jsx
import React, { useEffect, useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { useNavigate } from "react-router-dom";
import CalendarModal from "../components/CalendarModal";
import StudentDetailModal from "../components/StudentDetailModal";
import {
  exportExternalSchedulesToExcel,
  exportCenterSchedulesToExcel,
} from "../utils/exportScheduleToExcel";
import axiosInstance from "../axiosInstance";
import LiveWeekCalendar from "../components/LiveWeekCalendar";

/* =========================
   공용 응답 가드
   - 항상 JSON만 사용 (HTML/비정상 응답이면 throw)
   - 401/403이면 /admin/login 으로 보냄
========================= */
function useSafeJSON(navigate) {
  return async function safeJSON(promise) {
    try {
      const res = await promise;
      const ct =
        res?.headers?.["content-type"] || res?.headers?.get?.("content-type") || "";
      if (!res || !res.data || (typeof ct === "string" && ct.includes("text/html"))) {
        throw new Error("Invalid API response");
      }
      return res.data;
    } catch (err) {
      const status = err?.response?.status;
      const ct = err?.response?.headers?.["content-type"] || "";
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

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" ? v : {});

// ───────────────────────────────────────────
// 최신 제출만 남기기 + 강력 중복 제거 유틸
// ───────────────────────────────────────────
const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];

const normalizeType = (t) => {
  const v = (t ?? "").toString().trim().toLowerCase();
  if (v === "센터" || v === "center") return "센터";
  if (v === "외부" || v === "external" || v === "원외") return "외부";
  if (v === "미등원" || v === "absent") return "미등원";
  if (v === "빈구간") return "빈구간"; // 학생 입력(외부 라벨)용
  return (t ?? "").toString().trim();
};

// HH:MM 패딩 정규화
const normHHMM = (tt) => {
  const m = String(tt || "").trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return String(tt || "").trim();
  const h = String(Math.min(23, Number(m[1]))).padStart(2, "0");
  const mi = String(Math.min(59, Number(m[2]))).padStart(2, "0");
  return `${h}:${mi}`;
};

// 요일 정규화
const normDay = (d) => {
  const s = String(d || "").trim();
  if (DAY_ORDER.includes(s)) return s;
  // 혹시 Mon/Tue 등 들어오면 대비(간단 매핑)
  const map = { Mon: "월", Tue: "화", Wed: "수", Thu: "목", Fri: "금", Sat: "토", Sun: "일" };
  return map[s] || s;
};

// 한 행 정규화
const canon = (it = {}) => ({
  ...it,
  student_id: String(it.student_id ?? it.studentId ?? it.id ?? "").trim(),
  day: normDay(it.day),
  start: normHHMM(it.start),
  end: normHHMM(it.end),
  type: normalizeType(it.type),
  // 주차/저장 키는 비교만 하므로 문자열로만 통일
  week_start: (it.week_start || "").slice(0, 10),
  saved_at: it.saved_at || it.updated_at || it.created_at || "",
});

const pickLatestItems = (items) => {
  const input = arr(items).map(canon).filter((x) => x.student_id);
  if (!input.length) return input;

  const hasSavedAt = input.some((x) => x.saved_at);
  const hasWeekStart = input.some((x) => x.week_start);

  if (!hasSavedAt && !hasWeekStart) {
    // 서버가 최신만 내려주거나 과거 이관 데이터
    // 그래도 안전하게 완전 중복 제거
    const seen = new Set();
    const out = [];
    for (const r of input) {
      const k = [r.student_id, r.day, r.start, r.end, r.type].join("|");
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  }

  // 학생별 최신 키(우선: saved_at > week_start)
  const latestKeyByStudent = new Map();
  for (const it of input) {
    const key = hasSavedAt ? it.saved_at : it.week_start;
    const prev = latestKeyByStudent.get(it.student_id);
    if (!prev || key > prev) latestKeyByStudent.set(it.student_id, key);
  }

  // 최신만 남기고 완전 중복 제거
  const seen = new Set();
  const out = [];
  for (const r of input) {
    const key = hasSavedAt ? r.saved_at : r.week_start;
    if (latestKeyByStudent.get(r.student_id) !== key) continue;
    const k = [r.student_id, r.day, r.start, r.end, r.type].join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
};

const filterToLatestSchedules = (schedules) => pickLatestItems(arr(schedules));

export default function AdminDashboard() {
  const navigate = useNavigate();
  const safeJSON = useSafeJSON(navigate);

  // 상태
  const [students, setStudents] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [studentSchedules, setStudentSchedules] = useState([]);
  const [loading, setLoading] = useState(true);

  const [settings, setSettings] = useState({
    week_range_text: "",
    external_desc: "",
    external_example: "",
    center_desc: "",
    center_example: "",
    notification_footer: "",
  });

  // 등록 폼 & UI
  const [newStudent, setNewStudent] = useState({
    id: "",
    name: "",
    grade: "현역",
    studentPhone: "",
    parentPhone: "",
  });
  const [searchText, setSearchText] = useState("");
  const [nameSort, setNameSort] = useState("asc");

  // 캘린더/모달
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMode, setCalendarMode] = useState("");
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // ✅ 상세 모달에서 사용할 “서버 기준 최신 주차만” 결과
  const [detailLatest, setDetailLatest] = useState(null); // { id, completed, schedule: [...] }
  const [detailLoading, setDetailLoading] = useState(false);

  // ✅ 표 아래에서 보여줄 “선택 학생 캘린더”
  const [calendarStudent, setCalendarStudent] = useState(null);

  // 유틸
  const dayMap = { 월: 0, 화: 1, 수: 2, 목: 3, 금: 4, 토: 5 };

  const getBaseDate = () => {
    const m = settings.week_range_text.match(/(\d+)\/(\d+)\s*~\s*(\d+)\/(\d+)/);
    if (!m) return new Date();
    const month = parseInt(m[1], 10) - 1;
    const day = parseInt(m[2], 10);
    return new Date(new Date().getFullYear(), month, day);
  };
  const mondayify = (d) => {
    const nd = new Date(d);
    const dow = nd.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    nd.setDate(nd.getDate() + diff);
    nd.setHours(0, 0, 0, 0);
    return nd;
  };
  const toYmd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;

  // 인증 체크
  useEffect(() => {
    const token = localStorage.getItem("adminToken");
    if (!token) {
      navigate("/admin/login");
    }
  }, [navigate]);

  // 최초 로딩
  useEffect(() => {
    const token = localStorage.getItem("adminToken");
    if (!token) return;

    const load = async () => {
      try {
        const [settingsData, studentsData, schedulesData] = await Promise.all([
          safeJSON(axiosInstance.get(`/admin/settings`, { params: { _t: Date.now() } })),
          safeJSON(axiosInstance.get(`/admin/students`, { params: { _t: Date.now() } })),
          safeJSON(axiosInstance.get(`/admin/schedules`, { params: { _t: Date.now() } })),
        ]);

        const newSettings = obj(settingsData);
        const newStudents = arr(studentsData);
        const newSchedulesRaw = arr(schedulesData).map((x) => ({
          ...x,
          type: normalizeType(x?.type),
        }));
        const newSchedules = filterToLatestSchedules(newSchedulesRaw);

        setSettings(newSettings);
        setStudents(newStudents);
        setSchedules(newSchedules);

        // 학생별 요약(최신만)
        const byStudent = new Map();
        for (const s of newSchedules) {
          const list = byStudent.get(s.student_id) || [];
          list.push({ day: s.day, start: s.start, end: s.end, type: s.type });
          byStudent.set(s.student_id, list);
        }
        const nextStudentSchedules = newStudents.map((stu) => ({
          id: stu.id,
          completed: (byStudent.get(stu.id)?.length || 0) > 0,
          schedule: byStudent.get(stu.id) || [],
        }));
        setStudentSchedules(nextStudentSchedules);
        try {
          localStorage.setItem("studentSchedules", JSON.stringify(nextStudentSchedules));
        } catch {}

        // 캘린더 이벤트(학생 모드: 센터 + 외부 + 빈구간 라벨)
        const base = getBaseDate();
        setCalendarEvents(
          newSchedules
            .filter((it) => newStudents.some((s) => s.id === it.student_id))
            .map((it) => {
              const offset = dayMap[it.day] ?? 0;
              const d = new Date(base);
              d.setDate(base.getDate() + offset);
              const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
                d.getDate()
              ).padStart(2, "0")}`;
              const nm =
                newStudents.find((s) => s.id === it.student_id)?.name || it.student_id;

              const isExternalLike = it.type === "외부" || it.type === "빈구간";
              const label = (it.description || "").trim();
              const title = isExternalLike && label
                ? `${nm} ${it.start}~${it.end} (${it.type}) [${label}]`
                : `${nm} ${it.start}~${it.end} (${it.type || ""})`;

              return {
                title,
                start: `${ymd}T${it.start}`,
                end: `${ymd}T${it.end}`,
              };
            })
        );
      } catch (err) {
        console.error("❌ 데이터 로드 실패:", err);
        const code = err?.response?.status;
        if (code === 401 || code === 403) {
          alert("인증이 만료되었습니다. 다시 로그인하세요.");
          try {
            localStorage.removeItem("adminToken");
          } catch {}
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

  // 학생 목록 재조회
  const fetchStudents = async () => {
    try {
      const data = await safeJSON(axiosInstance.get("/admin/students"));
      setStudents(arr(data));
    } catch (err) {
      console.error("❌ 학생 목록 불러오기 실패:", err);
      alert("학생 목록을 불러오지 못했습니다.");
    }
  };

  // 설정 변경/저장
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
      const res = await axiosInstance.put("/admin/settings", settings);
      if (res.data?.success) {
        if (res.data.settings) {
          setSettings(res.data.settings);
        } else {
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
        `설정 저장 실패: ${err.response?.status || ""} ${
          err.response?.data?.error || err.message
        }`
      );
    }
  };

  // 학생 등록/삭제
  const generateStudentId = () => {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    let id = "";
    for (let i = 0; i < 3; i++) id += letters[Math.floor(Math.random() * letters.length)];
    for (let i = 0; i < 3; i++) id += numbers[Math.floor(Math.random() * numbers.length)];
    setNewStudent((prev) => ({ ...prev, id }));
  };

  const addStudent = async () => {
    const { id, name, grade, studentPhone, parentPhone } = newStudent;
    if (!id || !name) {
      alert("ID와 이름은 필수입니다.");
      return;
    }
    try {
      const res = await axiosInstance.post(`/admin/students`, {
        id,
        name,
        grade,
        studentPhone,
        parentPhone,
      });
      if (res.data?.success) {
        alert("학생 등록 성공");
        const next = [...students, { id, name, grade, studentPhone, parentPhone }];
        setStudents(next);
        try {
          localStorage.setItem("students", JSON.stringify(next));
        } catch {}
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
      console.error("[addStudent] error:", err);
      const msg =
        err.response?.data?.error ||
        (err.response ? `서버 오류: ${err.response.status}` : "서버에 연결할 수 없습니다.");
      alert(`학생 등록 실패: ${msg}`);
    }
  };

  const deleteStudent = async (id) => {
    if (!window.confirm("정말 이 학생을 삭제하시겠습니까?")) return;
    try {
      await axiosInstance.delete(`/admin/students/${id}`);
      await fetchStudents();
      alert("학생이 삭제되었습니다.");
    } catch (err) {
      console.error("학생 삭제 오류:", err);
      alert(err.response?.data?.error || "삭제 실패");
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm("⚠️ 정말 모든 학생 데이터를 삭제하시겠습니까?")) return;
    try {
      for (const s of students) {
        await axiosInstance.delete(`/admin/students/${s.id}`);
      }
      await fetchStudents();
      try {
        localStorage.removeItem("students");
      } catch {}
      alert("✅ 모든 학생 데이터가 삭제되었습니다.");
    } catch (err) {
      console.error("전체 삭제 오류:", err);
      alert(err.response?.data?.error || "전체 삭제 실패");
    }
  };

  // 캘린더
  const openCalendar = (mode) => {
    setCalendarMode(mode);
    setCalendarOpen(true);

    if (mode === "center") {
      const attendanceData = JSON.parse(localStorage.getItem("attendance") || "[]");
      const events = [];
      Object.keys(attendanceData).forEach((studentId) => {
        const studentName = students.find((s) => s.id === studentId)?.name || "";
        attendanceData[studentId].forEach((record) => {
          events.push({
            title: `${studentName} ${record.start}-${record.end}`,
            start: record.date,
          });
        });
      });
      setCalendarEvents(events);
    } else {
      const baseDate = getBaseDate();
      const latest = filterToLatestSchedules(schedules);
      const events = latest.map((item) => {
        const offset = dayMap[item.day] ?? 0;
        const date = new Date(baseDate);
        date.setDate(baseDate.getDate() + offset);
        const yyyyMMdd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(date.getDate()).padStart(2, "0")}`;
        const studentName =
          students.find((s) => s.id === item.student_id)?.name || item.student_id;

        const isExternalLike = item.type === "외부" || item.type === "빈구간";
        const label = (item.description || "").trim();
        const title = isExternalLike && label
          ? `${studentName} ${item.start}~${item.end} (${item.type}) [${label}]`
          : `${studentName} ${item.start}~${item.end} (${item.type || ""})`;

        return {
          title,
          start: `${yyyyMMdd}T${item.start}`,
          end: `${yyyyMMdd}T${item.end}`,
        };
      });
      setCalendarEvents(events);
    }
  };

  const handleCenterCalendarClick = () => {
    setCalendarMode("center");
    const latest = filterToLatestSchedules(schedules)
      .filter((sch) => sch.type === "센터");
    const events = latest.map((sch) => {
      const offset = dayMap[sch.day] ?? 0;
      const baseDate = getBaseDate();
      const d = new Date(baseDate);
      d.setDate(baseDate.getDate() + offset);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      const studentName = students.find((s) => s.id === sch.student_id)?.name || "";
      return {
        title: `${studentName} (${sch.start}~${sch.end})`,
        start: `${ymd}T${sch.start}`,
        end: `${ymd}T${sch.end}`,
        memo: sch.description || "",
      };
    });
    setCalendarEvents(events);
    setCalendarOpen(true);
  };

  // 학생 선택 시 일정 로드(캘린더 모달 내)
  const handleStudentSelect = async (studentId) => {
    if (!studentId) {
      setCalendarEvents([]);
      return;
    }
    try {
      const list = arr(await safeJSON(axiosInstance.get(`/student/schedule/${studentId}`)));
      const baseDate = getBaseDate();
      const events = list.map((item) => {
        const offset = dayMap[item.day] ?? 0;
        const date = new Date(baseDate);
        date.setDate(baseDate.getDate() + offset);
        const yyyyMMdd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(date.getDate()).padStart(2, "0")}`;

        const isExternalLike = item.type === "외부" || item.type === "빈구간";
        const label = (item.description || "").trim();
        const title = isExternalLike && label
          ? `${item.start}~${item.end} (${item.type}) [${label}]`
          : `${item.start}~${item.end} (${item.type || ""})`;

        return {
          title,
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

  // 상세 모달 열기/닫기 + 서버 기준 최신 주차 fetch (⚠ 누적 방지용 필터 추가)
  const openStudentDetail = async (student) => {
    setSelectedStudent(student);
    setIsDetailModalOpen(true);

    setDetailLoading(true);
    setDetailLatest(null);
    try {
      const rows = arr(await safeJSON(axiosInstance.get(`/student/schedule/${student.id}`)));
      const normalized = rows.map((x) => ({
        ...x,
        student_id: student.id,
        type: normalizeType(x.type),
      }));
      const latestOnly = filterToLatestSchedules(normalized).filter(
        (r) => r.student_id === student.id
      );
      const list = latestOnly.map((x) => ({
        day: x.day,
        start: x.start,
        end: x.end,
        type: x.type,
      }));
      setDetailLatest({ id: student.id, completed: list.length > 0, schedule: list });
    } catch (e) {
      console.error("학생 최신 스케줄 불러오기 실패:", e);
      setDetailLatest(null);
    } finally {
      setDetailLoading(false);
    }
  };
  const closeStudentDetail = () => {
    setSelectedStudent(null);
    setIsDetailModalOpen(false);
    setDetailLatest(null);
    setDetailLoading(false);
  };

  // 로컬 전체 스케줄에서 “최신 추정치”(백업용)
  const detailSchedulesMemo = useMemo(() => {
    if (!selectedStudent) return null;
    const latest = filterToLatestSchedules(schedules);
    const list = latest
      .filter((x) => x.student_id === selectedStudent.id)
      .map((x) => ({ day: x.day, start: x.start, end: x.end, type: x.type }));
    return { id: selectedStudent.id, completed: list.length > 0, schedule: list };
  }, [schedules, selectedStudent]);

  // ✅ 선택 학생의 캘린더 항목(센터/외부만)
  const selectedCalendarItems = useMemo(() => {
    if (!calendarStudent) return [];
    const latest = filterToLatestSchedules(schedules).filter(
      (x) => x.student_id === calendarStudent.id
    );
    return latest
      .filter((x) => x.type === "센터" || x.type === "외부")
      .map((x) => ({
        day: x.day,
        start: x.start,
        end: x.end,
        type: x.type === "센터" ? "센터" : "외부",
      }));
  }, [calendarStudent, schedules]);

  // ✅ 캘린더 주 시작(월요일) 문자열
  const weekStartYmd = useMemo(() => {
    const base = mondayify(getBaseDate());
    return toYmd(base);
  }, [settings.week_range_text]);

  // 문자 발송
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
    let message = `[안내] ${student.name}님의 이번 주 일정\n`;
    target.schedule.forEach((item) => {
      message += `${item.day}: ${item.start} ~ ${item.end} (${item.type})\n`;
    });
    if (settings.notification_footer) message += `\n${settings.notification_footer}`;

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

  // 검색/정렬 적용된 목록
  if (loading) return <div className="p-4 text-center text-lg">⏳ 데이터 로딩 중...</div>;

  const filteredStudents = students
    .filter((s) => (s.name || "").toLowerCase().includes(searchText.toLowerCase()))
    .sort((a, b) => {
      if (nameSort === "none") return 0;
      const cmp = (a.name || "").localeCompare(b.name || "", "ko");
      return nameSort === "asc" ? cmp : -cmp;
    });

  // 최신화
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
      const latestSchedulesRaw = arr(data.schedules).map((x) => ({
        ...x,
        type: normalizeType(x?.type),
      }));
      const latestSchedules = filterToLatestSchedules(latestSchedulesRaw);

      setStudents(latestStudents);
      setSchedules(latestSchedules);

      const base = getBaseDate();
      setCalendarEvents(
        latestSchedules
          .filter((it) => latestStudents.some((s) => s.id === it.student_id))
          .map((it) => {
            const offset = dayMap[it.day] ?? 0;
            const d = new Date(base);
            d.setDate(base.getDate() + offset);
            const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
              d.getDate()
            ).padStart(2, "0")}`;
            const nm =
              latestStudents.find((s) => s.id === it.student_id)?.name || it.student_id;

            const isExternalLike = it.type === "외부" || it.type === "빈구간";
            const label = (it.description || "").trim();
            const title = isExternalLike && label
              ? `${nm} ${it.start}~${it.end} (${it.type}) [${label}]`
              : `${nm} ${it.start}~${it.end} (${it.type || ""})`;

            return {
              title,
              start: `${ymd}T${it.start}`,
              end: `${ymd}T${it.end}`,
            };
          })
      );

      alert("✅ 일정이 최신화되었습니다!");
    } catch (err) {
      console.error("❌ 일정 최신화 실패:", err);
      const code = err?.response?.status;
      if (code === 401 || code === 403) {
        alert("세션이 만료되었습니다. 다시 로그인하세요.");
        try {
          localStorage.removeItem("adminToken");
        } catch {}
        navigate("/admin/login");
      } else {
        alert("일정 최신화 실패");
      }
    }
  };

  // 파일 내보내기/가져오기
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
    exportExternalSchedulesToExcel(schedules || [], students || [], buildFilenamePrefix("외부일정"), {
      rangeText: settings?.week_range_text || "",
      includeSunday: true,
    });
  };

  const handleExportCenterExcel = () => {
    exportCenterSchedulesToExcel(schedules || [], students || [], buildFilenamePrefix("센터일정"), {
      rangeText: settings?.week_range_text || "",
      includeSunday: true,
    });
  };

  const handleSaveAll = () => {
    const dataToSave = {
      students,
      settings,
      schedules,
      calendarEvents,
      studentSchedules,
    };
    const blob = new Blob([JSON.stringify(dataToSave, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "admin_dashboard_backup.json";
    a.click();
    URL.revokeObjectURL(url);
    alert("✅ 모든 데이터가 파일로 저장되었습니다.");
  };

  const handleFileImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (ext === "json") handleLoadJson(file);
    else if (ext === "xlsx" || ext === "xls") handleLoadExcel(file);
    else alert("지원하지 않는 파일 형식입니다. .json, .xlsx, .xls 만 가능합니다.");
    e.target.value = "";
  };

  const handleLoadJson = (file) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.students) setStudents(data.students);
        if (data.settings) setSettings(data.settings);
        if (data.schedules) setSchedules(filterToLatestSchedules(data.schedules));
        if (data.calendarEvents) setCalendarEvents(data.calendarEvents);

        const mapByStudent = new Map();
        for (const sch of filterToLatestSchedules(data.schedules || [])) {
          const list = mapByStudent.get(sch.student_id) || [];
          list.push({ day: sch.day, start: sch.start, end: sch.end, type: normalizeType(sch.type) });
          mapByStudent.set(sch.student_id, list);
        }
        const nextStudentSchedules = (data.students || []).map((s) => ({
          id: s.id,
          completed: (mapByStudent.get(s.id)?.length || 0) > 0,
          schedule: mapByStudent.get(s.id) || [],
        }));
        setStudentSchedules(nextStudentSchedules);

        try {
          localStorage.setItem("students", JSON.stringify(data.students || []));
          localStorage.setItem("studentSchedules", JSON.stringify(nextStudentSchedules || []));
        } catch {}
        alert("✅ JSON 데이터가 성공적으로 복원되었습니다!");
      } catch (error) {
        console.error(error);
        alert("❌ JSON 파일을 불러오는 중 오류가 발생했습니다.");
      }
    };
    reader.readAsText(file);
  };

  const handleLoadExcel = (file) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "binary" });

        const nextStudents = new Map();
        const schedulesExternal = [];
        const schedulesCenter = [];

        for (const s of students || []) {
          nextStudents.set(s.name || s.studentPhone || s.id, { ...s });
        }

        wb.SheetNames.forEach((sheetName) => {
          const ws = wb.Sheets[sheetName];
          if (!ws) return;

          const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          if (!json || json.length < 2) return;

          const a1 = (json[0]?.[0] || "").toString();
          const rangeTxt = extractRangeTextFromTitle(a1);
          if (rangeTxt) setSettings((prev) => ({ ...prev, week_range_text: rangeTxt }));

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

            const name = (cName !== -1 ? row[cName] : "").toString().trim();
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

        const nextSchedules = filterToLatestSchedules([...schedulesExternal, ...schedulesCenter]);
        setSchedules(nextSchedules);

        const mapByStudent = new Map();
        for (const sch of nextSchedules) {
          const list = mapByStudent.get(sch.student_id) || [];
          list.push({ day: sch.day, start: sch.start, end: sch.end, type: sch.type });
          mapByStudent.set(sch.student_id, list);
        }
        const nextStudentSchedules = mergedStudentsArr.map((s) => ({
          id: s.id,
          completed: (mapByStudent.get(s.id)?.length || 0) > 0,
          schedule: mapByStudent.get(s.id) || [],
        }));
        setStudentSchedules(nextStudentSchedules);

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

  // 제목에서 주차 텍스트 추출
  function extractRangeTextFromTitle(titleCellText) {
    if (!titleCellText) return "";
    const m = String(titleCellText).match(/\((\d{1,2}\/\d{1,2}\s*~\s*\d{1,2}\/\d{1,2})\)/);
    return m ? m[1] : "";
  }

  // "08:00~12:00, 13:00~17:00(설명)" 파싱
  function parseTimeRanges(cellText) {
    const text = String(cellText || "");
    const parts = text
      .split(/[,，;；\/\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const out = [];
    const RANGE_RE =
      /(\d{1,2}[:.]\d{1,2})\s*(?:~|∼|～|-)\s*(\d{1,2}[:.]\d{1,2})(?:\s*\(([^)]+)\))?/;

    for (const p of parts) {
      const m = p.match(RANGE_RE);
      if (!m) continue;
      const start = normalizeTime(m[1]);
      const end = normalizeTime(m[2]);
      const desc = (m[3] || "").trim();
      if (!start || !end) continue;
      out.push({ start, end, desc });
    }
    return out;
  }

  function normalizeTime(hhmm) {
    const m = String(hhmm).match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return "";
    const h = String(Math.min(23, Number(m[1]))).padStart(2, "0");
    const min = String(Math.min(59, Number(m[2]))).padStart(2, "0");
    return `${h}:${min}`;
  }

  function generateStudentIdLocal() {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    let id = "";
    for (let i = 0; i < 3; i++) id += letters[Math.floor(Math.random() * letters.length)];
    for (let i = 0; i < 3; i++) id += numbers[Math.floor(Math.random() * numbers.length)];
    return id;
  }

  // 표 하드닝 유틸
  const safeArray = (a) => (Array.isArray(a) ? a.filter(Boolean) : []);
  const isValidTime = (t) => typeof t === "string" && /^\d{1,2}:\d{1,2}$/.test(t);
  const toMin = (hhmm) => {
    if (!isValidTime(hhmm)) return NaN;
    const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
    return h * 60 + m;
  };
  const fromMin = (mm) =>
    Number.isFinite(mm) ? `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}` : "";

  // 센터 요약(기존 형식)
  function buildCenterSummaryRows(students = [], schedules = []) {
    const map = new Map();

    safeArray(filterToLatestSchedules(schedules))
      .filter((it) => (it?.type || "") === "센터")
      .forEach((it) => {
        const sid = it?.student_id;
        const day = it?.day;
        const s = it?.start;
        const e = it?.end;
        if (!sid || !DAY_ORDER.includes(day) || !isValidTime(s) || !isValidTime(e)) return;
        if (!map.has(sid)) map.set(sid, {});
        const byDay = map.get(sid);
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push({ s, e });
      });

    function mergeRanges(ranges) {
      const arr2 = safeArray(ranges)
        .map((r) => ({ s: toMin(r?.s), e: toMin(r?.e) }))
        .filter((r) => Number.isFinite(r.s) && Number.isFinite(r.e) && r.s < r.e)
        .sort((a, b) => a.s - b.s);

      const merged = [];
      for (const cur of arr2) {
        if (!merged.length || merged[merged.length - 1].e < cur.s) merged.push({ ...cur });
        else merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, cur.e);
      }
      return merged.map((r) => `${fromMin(r.s)}~${fromMin(r.e)}`).join(", ");
    }

    return safeArray(students).map((stu) => {
      const row = { id: stu?.id, name: stu?.name || stu?.id || "" };
      const byDay = map.get(stu?.id) || {};
      DAY_ORDER.forEach((d) => {
        row[d] = mergeRanges(byDay[d]);
      });
      return row;
    });
  }

  // 미등원 반영 + 첫 등원 계산
  function buildCenterAggWithAbsent(students = [], schedules = []) {
    const latest = filterToLatestSchedules(schedules);

    const absentSet = new Set();
    safeArray(latest).forEach((it) => {
      const sid = it?.student_id;
      const day = it?.day;
      const t = (it?.type || "").trim();
      const desc = (it?.description || "").trim();
      if (!sid || !DAY_ORDER.includes(day)) return;
      if (t === "미등원" || /미등원/.test(desc)) absentSet.add(`${sid}::${day}`);
    });

    const centerBy = new Map();
    safeArray(latest)
      .filter((it) => (it?.type || "") === "센터")
      .forEach((it) => {
        const sid = it?.student_id;
        const day = it?.day;
        const s = it?.start;
        const e = it?.end;
        if (!sid || !DAY_ORDER.includes(day) || !isValidTime(s) || !isValidTime(e)) return;
        if (!centerBy.has(sid)) centerBy.set(sid, {});
        const byDay = centerBy.get(sid);
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push({ start: s, end: e });
      });

    const rows = [];
    const firstArrivals = [];

    safeArray(students).forEach((stu) => {
      const sid = stu?.id;
      const name = stu?.name || sid || "";
      const byDay = centerBy.get(sid) || {};
      const row = { id: sid, name };
      const firstRow = { id: sid, name };

      DAY_ORDER.forEach((d) => {
        if (absentSet.has(`${sid}::${d}`)) {
          row[d] = "미등원";
          firstRow[d] = "미등원";
          return;
        }

        const blocks = safeArray(byDay[d])
          .map((b) => ({ s: toMin(b?.start), e: toMin(b?.end) }))
          .filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e) && b.s < b.e)
          .sort((a, b) => a.s - b.s);

        if (!blocks.length) {
          row[d] = "";
          firstRow[d] = "";
          return;
        }

        const merged = [];
        for (const cur of blocks) {
          if (!merged.length || merged[merged.length - 1].e < cur.s) merged.push({ ...cur });
          else merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, cur.e);
        }
        row[d] = merged.map((m) => `${fromMin(m.s)}~${fromMin(m.e)}`).join(", ");
        firstRow[d] = fromMin(blocks[0].s);
      });

      rows.push(row);
      firstArrivals.push(firstRow);
    });

    return { rows, firstArrivals, absentSet };
  }

  // 날짜 라벨
  function getWeekDateLabels(rangeText = "") {
    const m = String(rangeText).match(/(\d{1,2})\/(\d{1,2})\s*~\s*(\d{1,2})\/(\d{1,2})/);
    if (!m) return ["", "", "", "", "", "", ""];
    const year = new Date().getFullYear();
    const start = new Date(year, Number(m[1]) - 1, Number(m[2]) );
    const labels = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    }
    return labels;
  }

  function CenterSummaryTable({ students, schedules, weekRangeText }) {
    const rowsLegacy = buildCenterSummaryRows(students, schedules);
    const { rows, absentSet } = buildCenterAggWithAbsent(students, schedules);
    const dateLabels = getWeekDateLabels(weekRangeText);
    const SHOW_MANUAL_ABSENT_BUTTON = false;

    return (
      <div className="overflow-auto">
        <table className="table-auto w-full border">
          <thead>
            <tr className="bg-gray-200 text-center">
              <th className="border px-2 py-1 w-24">ID</th>
              <th className="border px-2 py-1 w-28">이름</th>
              {DAY_ORDER.map((d, idx) => (
                <th key={d} className="border px-2 py-1">
                  {d}
                  {dateLabels[idx] ? `(${dateLabels[idx]})` : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {safeArray(rows.length ? rows : rowsLegacy).map((r) => (
              <tr key={r.id || Math.random()} className="text-center align-top">
                <td className="border px-2 py-1">{r.id}</td>
                <td className="border px-2 py-1">{r.name}</td>
                {DAY_ORDER.map((d) => {
                  const isAbsentAuto =
                    r[d] === "미등원" || absentSet.has(`${r.id}::${d}`);
                  const cellText = r[d] || "";
                  return (
                    <td key={d} className="border px-2 py-1">
                      <div
                        className={`min-h-[2.25rem] ${
                          isAbsentAuto ? "text-red-600 font-semibold" : ""
                        }`}
                      >
                        {isAbsentAuto ? "미등원" : cellText || <span className="text-gray-400">—</span>}
                      </div>
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
          * 표는 학생이 입력한 <b>센터</b> 시간만 반영됩니다. “미등원”은 학생 입력을 기준으로 자동
          표시됩니다.
        </p>
      </div>
    );
  }

  function FirstArrivalTable({ students, schedules, weekRangeText }) {
    const { firstArrivals, absentSet } = buildCenterAggWithAbsent(students, schedules);
    const dateLabels = getWeekDateLabels(weekRangeText);

    return (
      <div className="overflow-auto">
        <table className="table-auto w-full border">
          <thead>
            <tr className="bg-gray-200 text-center">
              <th className="border px-2 py-1 w-24">ID</th>
              <th className="border px-2 py-1 w-28">이름</th>
              {DAY_ORDER.map((d, idx) => (
                <th key={d} className="border px-2 py-1">
                  {d}
                  {dateLabels[idx] ? `(${dateLabels[idx]})` : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {safeArray(firstArrivals).map((r) => (
              <tr key={r.id || Math.random()} className="text-center">
                <td className="border px-2 py-1">{r.id}</td>
                <td className="border px-2 py-1">{r.name}</td>
                {DAY_ORDER.map((d) => {
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

  // UI
  return (
    <div className="p-4 max-w-6xl mx-auto">
      {/* 모달 스크롤 전역 보정 */}
      <style>{`
        /* 오버레이가 fixed inset-0 패턴일 때 내부 컨테이너 스크롤 허용 */
        .fixed.inset-0 > * {
          max-height: 90vh;
          overflow-y: auto;
        }
        /* 상세 모달 내 긴 리스트(이번 주 일정)도 스크롤되도록 */
        .fixed.inset-0 [data-section="student-week-list"] {
          max-height: 36vh;
          overflow-y: auto;
        }
      `}</style>

      <h1 className="text-2xl font-bold mb-4">관리자 페이지</h1>

      <div className="flex gap-4 mb-6">
        <button onClick={() => openCalendar("student")} className="bg-blue-500 text-white px-4 py-2 rounded">
          학생 별 일정표(캘린더)
        </button>
        <button onClick={handleCenterCalendarClick} className="bg-green-500 text-white px-4 py-2 rounded">
          센터 재원 시간(캘린더)
        </button>

        <button onClick={refreshSchedules} className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600">
          학생일정 최신화
        </button>

        <button onClick={handleExportExternalExcel} className="bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700">
          외부 일정 엑셀
        </button>
        <button onClick={handleExportCenterExcel} className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700">
          센터 일정 엑셀
        </button>

        <button onClick={handleSaveAll} className="bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600">
          전체 저장
        </button>

        <input type="file" accept=".json,.xlsx,.xls" onChange={handleFileImport} className="border px-2 py-1" />
      </div>

      <div>
        <CalendarModal
          isOpen={calendarOpen}
          onClose={() => setCalendarOpen(false)}
          mode={calendarMode}
          students={students}
          events={calendarEvents}
          onStudentSelect={handleStudentSelect}
        />
      </div>

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

      <div className="flex justify-between mb-4">
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="학생 이름 검색"
          className="border border-gray-350 px-2 py-1 mb-2 rounded w-full"
        />
        <button onClick={handleDeleteAll} className="bg-red-500 text-white px-10 py-1 rounded hover:bg-red-600">
          Delete All
        </button>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm text-gray-600">정렬:</span>
        <button
          onClick={() => setNameSort("asc")}
          className={`px-3 py-1 rounded border ${nameSort === "asc" ? "bg-gray-800 text-white" : "bg-white"}`}
        >
          이름(가나다)
        </button>
        <button
          onClick={() => setNameSort("desc")}
          className={`px-3 py-1 rounded border ${nameSort === "desc" ? "bg-gray-800 text-white" : "bg-white"}`}
        >
          이름(역순)
        </button>
        <button
          onClick={() => setNameSort("none")}
          className={`px-3 py-1 rounded border ${nameSort === "none" ? "bg-gray-800 text-white" : "bg-white"}`}
        >
          정렬 해제
        </button>
      </div>

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
                <div className="flex items-center justify-center gap-2">
                  <button onClick={() => openStudentDetail(s)} className="bg-blue-500 text-white px-2 py-1 rounded">
                    상세
                  </button>
                  <button
                    onClick={() => setCalendarStudent(s)}
                    className="bg-slate-600 text-white px-2 py-1 rounded hover:bg-slate-700"
                    title="이 학생의 주간 캘린더를 아래에서 확인"
                  >
                    캘린더
                  </button>
                </div>
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
                <button onClick={() => deleteStudent(s.id)} className="bg-red-500 text-white px-2 py-1 rounded">
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {calendarStudent && (
        <div className="border p-4 mb-6 rounded bg-white">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">
              {calendarStudent.name} 님 주간 캘린더
            </h2>
            <button
              className="text-sm border px-3 py-1 rounded hover:bg-gray-50"
              onClick={() => setCalendarStudent(null)}
            >
              닫기
            </button>
          </div>
          <LiveWeekCalendar
            weekStartYmd={weekStartYmd}
            items={selectedCalendarItems}
            title={`${settings?.week_range_text || ""} (센터/외부)`}
          />
          <p className="text-xs text-gray-500 mt-2">
            * “센터”와 “외부(빈구간 라벨 입력)”만 표시됩니다. “미등원”은 캘린더에 표시하지 않습니다.
          </p>
        </div>
      )}

      <div className="border p-4 mb-6 rounded">
        <h2 className="text-lg font-semibold mb-3">학생별 센터 재원 요약</h2>
        <CenterSummaryTable
          students={students}
          schedules={schedules}
          weekRangeText={settings?.week_range_text || ""}
        />
      </div>

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
        <button onClick={saveSettings} className="bg-blue-500 text-white px-4 py-2 rounded mt-4">
          설정 저장
        </button>
      </div>

      {/* 상세 모달: 서버 기준 최신 주차 결과를 우선 전달 */}
      <div>
        {isDetailModalOpen && selectedStudent && (
          <StudentDetailModal
            isOpen={isDetailModalOpen}
            onClose={closeStudentDetail}
            student={selectedStudent}
            schedules={detailLatest ?? detailSchedulesMemo}
            settings={settings}
            listWrapperAttr={{ "data-section": "student-week-list" }}
            loading={detailLoading}
            onUpdateStudent={async (updated) => {
              try {
                await axiosInstance.put(`/admin/students/${updated.id}`, {
                  name: updated.name ?? "",
                  grade: updated.grade ?? "",
                  studentPhone: updated.studentPhone ?? "",
                  parentPhone: updated.parentPhone ?? "",
                });
                const updatedList = students.map((s) =>
                  s.id === updated.id ? { ...s, ...updated } : s
                );
                setStudents(updatedList);
                try {
                  localStorage.setItem("students", JSON.stringify(updatedList));
                } catch {}
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
    </div>
  );
}
