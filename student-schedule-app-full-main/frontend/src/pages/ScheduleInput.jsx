// frontend/src/pages/ScheduleInput.jsx
import React, { useState, useEffect, useMemo, useRef } from "react"; // ✅ useRef 추가
import axios from "../axiosInstance";
import { useNavigate } from "react-router-dom";
import LiveWeekCalendar from "../components/LiveWeekCalendar";

/**
 * 변경 요약 (2025-08-14):
 * - 저장 전 검증 추가(부분 입력/범위/순서 오류 시 요일·행 번호로 alert)
 * - 요일 제목 옆에 해당 날짜(M/D) 표기 (weekStart=월 기준)
 * - 각 요일별 '미등원' 토글(입력 비활성화, 검증·저장 제외)
 * - 기존 기능 유지(최근 저장본/지난주 로딩/HH·MM 분리 텍스트 입력 등)
 * - ✅ 센터 외 시간 활동(빈구간 라벨) 미입력 시 저장 차단 + 팝업 안내
 * - ✅ 시각적 강조: 누락/오류 입력칸 빨간 테두리 표시(저장 시도 후)
 * - ✅ 관리자 설정의 시작 날짜(예: 8/18~8/24)를 학생 화면의 기준 주(월요일)로 연동
 * - ✅ 라이브 주간 캘린더 추가(센터/외부), 입력 즉시 실시간 반영
 * - ✅ “아니요, 수정해서 제출할게요” 클릭 시 노란 박스 즉시 숨김(해당 주 재방문 시에도 안 보임)
 * - ✅ 외부 일정은 type: "외부", description: 라벨 로 저장해 관리 캘린더에 표시
 */
export default function ScheduleInput() {
  const navigate = useNavigate();
  const days = ["월", "화", "수", "목", "금", "토", "일"];

  // ----- 주간 계산 유틸 -----
  const toYmd = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const getWeekStartMonday = (baseDate = new Date()) => {
    const d = new Date(baseDate);
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // ✅ 관리자 week_range_text("8/18~8/24")에서 시작일을 뽑아 월요일로 정렬
  const parseAdminWeekStart = (rangeText) => {
    if (!rangeText) return null;
    const m = rangeText.match(/(\d{1,2})\s*\/\s*(\d{1,2})/); // 첫 날짜 MM/DD 추출
    if (!m) return null;
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    const now = new Date();
    let year = now.getFullYear();
    const d = new Date(year, mm - 1, dd);
    d.setHours(0, 0, 0, 0);
    // 월요일로 스냅(관리자가 월요일이 아닌 날짜를 입력해도 월요일 사용)
    const dow = d.getDay(); // 0=일..1=월..6=토
    const diff = (dow === 0 ? -6 : 1 - dow);
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // 초기값은 "오늘 기준 주"로, 이후 설정을 로드하면 관리자 값으로 갱신함
  const mondayThis = getWeekStartMonday();
  const mondayPrev = new Date(mondayThis.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [weekStart, setWeekStart] = useState(toYmd(mondayThis)); // 이번 주(저장 대상)
  const [prevWeekStart, setPrevWeekStart] = useState(toYmd(mondayPrev)); // 지난 주
  const [viewWeekStart, setViewWeekStart] = useState(toYmd(mondayThis)); // 화면에 보여주는 주
  const isViewingPrev = viewWeekStart === prevWeekStart;

  // ❗️이번 주 노란 박스(지난주 동일?) 숨김 키 (주차별)
  const samePromptKey = useMemo(() => `samePromptHidden:${weekStart}`, [weekStart]);

  // 요일별 실제 날짜 (weekStart=월요일 기준)
  const weekDates = useMemo(() => {
    const base = new Date(weekStart);
    const arr = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      arr.push(d);
    }
    return arr; // Date[]
  }, [weekStart]);
  const formatMD = (date) => `${date.getMonth() + 1}/${date.getDate()}`;

  // 학생 세션
  const student = useMemo(() => {
    const stored = localStorage.getItem("student");
    return stored ? JSON.parse(stored) : null;
  }, []);

  // 설정(상단 안내문 등)
  const [settings, setSettings] = useState({
    week_range_text: "",
    center_desc: "",
    center_example: "",
    notification_footer: "",
  });

  // 08:00 ~ 23:00만 허용 (계산 단계에서만 적용)
  const H_START = 8;
  const H_END = 23;

  // 센터 스케줄 구조
  const createInitialData = () => ({
    센터: days.map(() => [{ start: "", startMin: "", end: "", endMin: "" }]),
  });
  const [schedule, setSchedule] = useState(createInitialData());

  // 요일별 미등원 토글
  const [absentDays, setAbsentDays] = useState(() => days.map(() => false));
  const toggleAbsent = (dayIdx) =>
    setAbsentDays((prev) => {
      const next = prev.slice();
      next[dayIdx] = !next[dayIdx];
      return next;
    });

  // 🔹 미등원 로컬 스토리지 보존 유틸 (주차별/학생별)
  const absentKey = useMemo(
    () => `absentDays:${student?.id ?? "anon"}:${viewWeekStart}`,
    [student?.id, viewWeekStart]
  );
  const loadAbsentFromStorage = () => {
    try {
      const raw = localStorage.getItem(absentKey);
      if (!raw) return days.map(() => false);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === days.length) return parsed;
      return days.map(() => false);
    } catch {
      return days.map(() => false);
    }
  };
  // 주차 전환/초기 진입 시 로드
  useEffect(() => {
    setAbsentDays(loadAbsentFromStorage());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absentKey]);
  // 토글될 때마다 저장
  useEffect(() => {
    try {
      localStorage.setItem(absentKey, JSON.stringify(absentDays));
    } catch {}
  }, [absentDays, absentKey]);

  // ✅ 오토세이브 상태/타이머
  const [autoSaveStatus, setAutoSaveStatus] = useState(""); // "", "saving", "saved", "error"
  const [lastAutoSaveAt, setLastAutoSaveAt] = useState(null); // Date | null
  const autoSaveTimer = useRef(null);

  // ✅ 에러 표시 토글 (저장 시도 후에만 빨간 테두리 표시)
  const [showErrors, setShowErrors] = useState(false); // ✅ 추가

  // 문자 발송 관련
  const [studentPhone, setStudentPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [previewTarget, setPreviewTarget] = useState("student");
  const [loading, setLoading] = useState(false);

  // 지난주 동일 배너
  const [showPrevWeekPrompt, setShowPrevWeekPrompt] = useState(false);
  const [hasPrevWeek, setHasPrevWeek] = useState(false);

  // 빈구간 라벨 상태
  const [gapLabels, setGapLabels] = useState(() => days.map(() => []));

  // 최근 저장본(최대 3개)
  const [recentSaves, setRecentSaves] = useState([]);

  // 로그인 체크
  useEffect(() => {
    if (!student) {
      alert("로그인이 필요합니다.");
      navigate("/login");
    }
  }, [student, navigate]);

  // 설정 로드 (✅ 설정의 시작 날짜를 주 기준으로 반영)
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await axios.get(`/student/settings`);
        const next = {
          week_range_text: res.data?.week_range_text ?? "",
          center_desc: res.data?.center_desc ?? "",
          center_example: res.data?.center_example ?? "",
          notification_footer: res.data?.notification_footer ?? "",
        };
        setSettings(next);

        const startDate = parseAdminWeekStart(next.week_range_text);
        if (startDate) {
          const ws = toYmd(startDate);
          const ps = toYmd(new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000));
          setWeekStart(ws);
          setPrevWeekStart(ps);
          setViewWeekStart(ws);
        }
      } catch (e) {
        console.error("❌ 설정 불러오기 오류:", e);
      }
    };
    fetchSettings();
  }, []);

  // ===== 시간 파싱 유틸 (입력 중 자동보정 없음) =====
  const toMinutes = (hh, mm) => {
    if (hh === "" || mm === "") return null;
    const h = parseInt(hh, 10);
    const m = parseInt(mm, 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };

  // 센터 block 추가/삭제
  const addRow = (dayIdx) => {
    setSchedule((prev) => {
      const next = structuredClone(prev);
      next.센터[dayIdx].push({ start: "", startMin: "", end: "", endMin: "" });
      return next;
    });
  };
  const removeRow = (dayIdx, rowIdx) => {
    setSchedule((prev) => {
      const next = structuredClone(prev);
      next.센터[dayIdx].splice(rowIdx, 1);
      if (next.센터[dayIdx].length === 0) {
        next.센터[dayIdx].push({ start: "", startMin: "", end: "", endMin: "" });
      }
      return next;
    });
  };

  // 입력 그대로 저장 (자동 보정/패딩 없음)
  const updateCell = (dayIdx, rowIdx, key, value) => {
    setSchedule((prev) => {
      const next = structuredClone(prev);
      next.센터[dayIdx][rowIdx][key] = value.replace(/\D/g, ""); // 숫자만
      return next;
    });
  };

  // 정렬/검증된 센터 블록 계산 (여기서만 범위/겹침 처리)
  const getSortedValidBlocks = (rows) => {
    const minBound = H_START * 60;
    const maxBound = H_END * 60;

    const raw = rows
      .map((r) => {
        const s = toMinutes(r.start, r.startMin);
        const e = toMinutes(r.end, r.endMin);
        return s !== null && e !== null && s < e ? { s, e } : null;
      })
      .filter(Boolean);

    // 08:00~23:00로 클리핑
    const clipped = raw
      .map((b) => ({ s: Math.max(minBound, b.s), e: Math.min(maxBound, b.e) }))
      .filter((b) => b.s < b.e);

    // 시작시간 정렬 + 겹침 병합
    clipped.sort((a, b) => a.s - b.s);
    const merged = [];
    for (const cur of clipped) {
      if (!merged.length || merged[merged.length - 1].e <= cur.s) merged.push({ ...cur });
      else merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, cur.e);
    }

    // HH/MM 포맷 반환
    return merged.map((b) => {
      const sh = String(Math.floor(b.s / 60)).padStart(2, "0");
      const sm = String(b.s % 60).padStart(2, "0");
      const eh = String(Math.floor(b.e / 60)).padStart(2, "0");
      const em = String(b.e % 60).padStart(2, "0");
      return { ...b, start: sh, startMin: sm, end: eh, endMin: em };
    });
  };

  // 빈 구간 계산
  const computeGaps = (rows) => {
    const blocks = getSortedValidBlocks(rows);
    const gaps = [];
    const minBound = H_START * 60;
    const maxBound = H_END * 60;
    let cur = minBound;
    for (const b of blocks) {
      if (cur < b.s) gaps.push([cur, b.s]);
      cur = Math.max(cur, b.e);
    }
    if (cur < maxBound) gaps.push([cur, maxBound]);

    return gaps.map(([s, e]) => {
      const sh = String(Math.floor(s / 60)).padStart(2, "0");
      const sm = String(s % 60).padStart(2, "0");
      const eh = String(Math.floor(e / 60)).padStart(2, "0");
      const em = String(e % 60).padStart(2, "0");
      return { start: `${sh}:${sm}`, end: `${eh}:${em}` };
    });
  };

  // 센터 rows 변화에 따라 gapLabels 동기화 (미등원일 땐 비움)
  useEffect(() => {
    setGapLabels((prev) =>
      schedule.센터.map((rows, dayIdx) => {
        if (absentDays[dayIdx]) return [];
        const gaps = computeGaps(rows);
        const old = prev[dayIdx] || [];
        return gaps.map((g) => {
          const found = old.find((o) => o.start === g.start && o.end === g.end);
          return found || { ...g, label: "" };
        });
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, absentDays.join("|")]);

  const setGapLabel = (dayIdx, idx, label) => {
    setGapLabels((prev) => {
      const next = prev.map((arr) => arr.slice());
      if (!next[dayIdx]) next[dayIdx] = [];
      if (!next[dayIdx][idx]) next[dayIdx][idx] = { start: "", end: "", label: "" };
      next[dayIdx][idx] = { ...next[dayIdx][idx], label };
      return next;
    });
  };

  // ===== 주간 데이터 로드 (신 API 우선, 구 API 폴백) =====
  const loadWeek = async ({ targetWeekStart, preferPrevious = false }) => {
    if (!student?.id) return { ok: false, hasData: false };
    try {
      const res = await axios.get(`/student/schedules/${student.id}?weekStart=${targetWeekStart}`);
      const list = res.data || [];
      applyListToForm(list);
      return { ok: true, hasData: list.length > 0 };
    } catch {
      try {
        const res2 = await axios.get(`/student/schedules/${student.id}`);
        const list2 = Array.isArray(res2.data) ? res2.data : [];
        const filtered = list2.filter((it) => (it.week_start ? it.week_start === targetWeekStart : true));
        const src = filtered.length || preferPrevious ? filtered : list2;
        applyListToForm(src);
        return { ok: true, hasData: src.length > 0 };
      } catch (e2) {
        console.error("❌ 스케줄 로드 실패:", e2);
        return { ok: false, hasData: false };
      }
    }
  };

  const applyListToForm = (list) => {
    const next = createInitialData();
    const byDayCenter = Object.fromEntries(days.map((d) => [d, []]));
    const byDayGaps = Object.fromEntries(days.map((d) => [d, []]));
    (list || []).forEach((it) => {
      if (it.type === "센터") {
        const [sh, sm] = String(it.start).split(":");
        const [eh, em] = String(it.end).split(":");
        byDayCenter[it.day]?.push({ start: sh || "", startMin: sm || "", end: eh || "", endMin: em || "" });
      } else if (it.type === "빈구간" || it.type === "외부") { // ✅ 외부도 동일 처리
        byDayGaps[it.day]?.push({ start: it.start, end: it.end, label: it.description || "" });
      }
    });
    days.forEach((d, idx) => {
      next.센터[idx] = byDayCenter[d].length ? byDayCenter[d] : [{ start: "", startMin: "", end: "", endMin: "" }];
    });
    setSchedule(next);

    // ✅ 서버 '미등원' 복원(없으면 로컬값 폴백)
    const absentCalc = days.map((d) => (list || []).some((it) => it.day === d && it.type === "미등원"));
    const finalAbsent = absentCalc.some(Boolean) ? absentCalc : loadAbsentFromStorage();
    setAbsentDays(finalAbsent);
    try { localStorage.setItem(absentKey, JSON.stringify(finalAbsent)); } catch {}

    // gap 틀에 라벨 주입
    setGapLabels(() =>
      days.map((d, idx) => {
        const gaps = computeGaps(next.센터[idx]);
        return gaps.map((g) => {
          const found = (byDayGaps[d] || []).find((x) => x.start === g.start && x.end === g.end);
          return found ? { ...g, label: found.label || "" } : { ...g, label: "" };
        });
      })
    );
  };

  // 최근 저장본 3개 조회
  const toCompactYmd = (s = "") => (s ? s.slice(0, 10).replace(/-/g, "") : "");
  const fetchRecentSaves = async () => {
    if (!student?.id) return;
    // 1) 서버 전용 엔드포인트 시도
    try {
      const r = await axios.get(`/student/saves/${student.id}?limit=3`);
      if (Array.isArray(r.data) && r.data.length) {
        const items = r.data
          .map((it, i) => {
            const week = it.week_start || (it.saved_at || it.updated_at || it.created_at || "").slice(0, 10);
            if (!week) return null;
            return { key: `${week}-${i}`, weekStart: week, label: toCompactYmd(week) };
          })
          .filter(Boolean)
          .slice(0, 3);
        setRecentSaves(items);
        return;
      }
    } catch {
      /* 폴백 진행 */
    }

    // 2) 폴백: 전체 스케줄에서 그룹핑
    try {
      const res = await axios.get(`/student/schedules/${student.id}`);
      const list = Array.isArray(res.data) ? res.data : [];
      const group = new Map();
      for (const it of list) {
        let key = it.week_start;
        if (!key) {
          const stamp = (it.updated_at || it.created_at || "").slice(0, 10);
          key = stamp || "unknown";
        }
        if (!group.has(key)) group.set(key, []);
        group.get(key).push(it);
      }
      const sortedKeys = Array.from(group.keys()).sort((a, b) => (a > b ? -1 : 1));
      const picks = sortedKeys.slice(0, 3).map((k, i) => ({ key: `${k}-${i}`, weekStart: k, label: toCompactYmd(k) || "unknown" }));
      setRecentSaves(picks);
    } catch (e) {
      console.error("❌ recent saves 폴백 실패:", e);
      setRecentSaves([]);
    }
  };

  const handleLoadRecent = async (item) => {
    if (!student?.id) return;
    setLoading(true);
    try {
      await loadWeek({ targetWeekStart: item.weekStart, preferPrevious: true });
      setViewWeekStart(item.weekStart);
    } catch (e) {
      console.error("❌ 최근 저장본 로드 실패:", e);
      alert("최근 저장본을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // 첫 진입 (✅ weekStart/prevWeekStart가 설정값으로 바뀌면 재실행)
  useEffect(() => {
    const boot = async () => {
      if (!student?.id) return;
      setViewWeekStart(weekStart);
      const now = await loadWeek({ targetWeekStart: weekStart });
      if (!now.hasData) {
        const prev = await loadWeek({ targetWeekStart: prevWeekStart, preferPrevious: true });
        if (prev.hasData) {
          setViewWeekStart(prevWeekStart);
          // 로컬 플래그 확인(해당 주차에서 노란 박스 숨기기 요청된 적 있으면 보여주지 않음)
          const hidden = (() => {
            try { return localStorage.getItem(samePromptKey) === "1"; } catch { return false; }
          })();
          setShowPrevWeekPrompt(!hidden);
          setHasPrevWeek(true);
        } else {
          setShowPrevWeekPrompt(false);
          setHasPrevWeek(false);
          setSchedule(createInitialData());
          setGapLabels(days.map(() => []));
        }
      } else {
        setShowPrevWeekPrompt(false);
        setHasPrevWeek(false);
      }
      await fetchRecentSaves();
    };
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, weekStart, prevWeekStart, samePromptKey]);

  // ✅ 폼이 비어 있으면 서버 임시본(draft) 복원 시도 (정식 저장이 없을 때 우선)
  const isEmptyForm = useMemo(() => {
    // 모든 요일이 1행이고 네 칸이 전부 빈 문자열인 경우를 "비어 있음"으로 간주
    try {
      return schedule.센터.every((rows) =>
        rows.length === 1 &&
        rows[0].start === "" &&
        rows[0].startMin === "" &&
        rows[0].end === "" &&
        rows[0].endMin === ""
      );
    } catch {
      return false;
    }
  }, [schedule]);
  useEffect(() => {
    const tryLoadDraft = async () => {
      if (!student?.id || !weekStart) return;
      if (!isEmptyForm) return; // 이미 뭔가 로드됨
      try {
        const dr = await axios.get(`/student/schedules/draft`, {
          params: { student_id: student.id, weekStart }
        });
        const draft = dr?.data || null;
        if (draft && draft.scheduleRaw && draft.gapLabelsRaw && Array.isArray(draft.absentDays)) {
          setSchedule(draft.scheduleRaw);
          setGapLabels(draft.gapLabelsRaw);
          setAbsentDays(draft.absentDays);
          try { localStorage.setItem(absentKey, JSON.stringify(draft.absentDays)); } catch {}
          setViewWeekStart(weekStart);
          setShowPrevWeekPrompt(false);
          setHasPrevWeek(false);
        }
      } catch {
        /* 임시본 없음/실패는 무시 */
      }
    };
    tryLoadDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, weekStart, isEmptyForm]);

  // ✅ 센터 외 활동(빈구간 라벨) 누락 목록 수집 유틸 -------------- // ✅ 추가
  const getUnlabeledGapsForDay = (dayIdx) => {
    const gaps = computeGaps(schedule.센터[dayIdx]); // [{start, end}]
    const labels = gapLabels[dayIdx] || [];
    const missing = [];
    gaps.forEach((g, i) => {
      const label = (labels[i]?.label || "").trim();
      if (!label) missing.push(`${g.start}~${g.end}`);
    });
    return missing;
  };

  // ✅ 입력칸 오류 하이라이트 계산(저장 시도 후만 표시) ----------- // ✅ 추가
  const getCenterRowErrors = (dayIdx, rowIdx) => {
    const row = schedule.센터[dayIdx][rowIdx];
    const errs = { start: false, startMin: false, end: false, endMin: false };
    if (!showErrors || absentDays[dayIdx]) return errs;

    const any =
      (row.start ?? "") !== "" ||
      (row.startMin ?? "") !== "" ||
      (row.end ?? "") !== "" ||
      (row.endMin ?? "") !== "";

    if (!any) return errs;

    // 필수
    if (!row.start) errs.start = true;
    if (!row.startMin) errs.startMin = true;
    if (!row.end) errs.end = true;
    if (!row.endMin) errs.endMin = true;

    // 범위/숫자
    const sh = parseInt(row.start, 10);
    const sm = parseInt(row.startMin, 10);
    const eh = parseInt(row.end, 10);
    const em = parseInt(row.endMin, 10);
    if (row.start && (Number.isNaN(sh) || sh < H_START || sh > H_END)) errs.start = true;
    if (row.startMin && (Number.isNaN(sm) || sm < 0 || sm > 59)) errs.startMin = true;
    if (row.end && (Number.isNaN(eh) || eh < H_START || eh > H_END)) errs.end = true;
    if (row.endMin && (Number.isNaN(em) || em < 0 || em > 59)) errs.endMin = true;

    // 순서
    if (!Number.isNaN(sh) && !Number.isNaN(sm) && !Number.isNaN(eh) && !Number.isNaN(em)) {
      const s = sh * 60 + sm;
      const e = eh * 60 + em;
      if (!(s < e)) {
        errs.start = true;
        errs.startMin = true;
        errs.end = true;
        errs.endMin = true;
      }
    }
    return errs;
  };

  // ===== 저장 전 검증 =====
  const validateBeforeSave = () => {
    // 1) 센터(입력/범위/순서 등) 검증
    for (let d = 0; d < days.length; d++) {
      if (absentDays[d]) continue; // 미등원은 패스
      const rows = schedule.센터[d];

      let anyRowHasInput = false;

      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const hasAny =
          (row.start ?? "") !== "" ||
          (row.startMin ?? "") !== "" ||
          (row.end ?? "") !== "" ||
          (row.endMin ?? "") !== "";
        if (!hasAny) continue; // 완전히 비어 있으면 무시
        anyRowHasInput = true;

        // 1) 네 칸 모두 입력되었는지
        if (!row.start || !row.startMin || !row.end || !row.endMin) {
          alert(`${days[d]} ${r + 1}번째 구간: 시작/종료의 '시'와 '분'을 모두 입력해주세요.`);
          return false;
        }

        // 2) 숫자 범위
        const sh = parseInt(row.start, 10);
        const sm = parseInt(row.startMin, 10);
        const eh = parseInt(row.end, 10);
        const em = parseInt(row.endMin, 10);

        if (
          Number.isNaN(sh) || Number.isNaN(sm) ||
          Number.isNaN(eh) || Number.isNaN(em)
        ) {
          alert(`${days[d]} ${r + 1}번째 구간: 시간은 숫자만 입력해주세요.`);
          return false;
        }

        if (sh < H_START || sh > H_END || eh < H_START || eh > H_END || sm < 0 || sm > 59 || em < 0 || em > 59) {
          alert(`${days[d]} ${r + 1}번째 구간: 시간은 ${String(H_START).padStart(2, "0")}:00 ~ ${String(H_END).padStart(2, "0")}:59 사이여야 합니다.`);
          return false;
        }

        // 3) 시작 < 종료
        const s = sh * 60 + sm;
        const e = eh * 60 + em;
        if (!(s < e)) {
          alert(`${days[d]} ${r + 1}번째 구간: 시작 시간이 종료 시간보다 빠르거나 같아서는 안 됩니다.`);
          return false;
        }
      }

      // 🔸 요일 전체가 공백이면 안내 (미등원 아님)
      if (!anyRowHasInput) {
        alert(`${days[d]}요일에 입력되지 않은 칸이 있습니다. 모든 칸을 입력했는지 확인해주세요 안오는 날은 '미등원'을 눌러주세요!`);
        return false;
      }

      // 🔸 유효 블록이 하나도 남지 않는 경우(범위 밖/겹침 클리핑 등)
      const valid = getSortedValidBlocks(rows);
      if (valid.length === 0) {
        alert(`${days[d]}: 유효한 구간이 없습니다. 시간 범위를 확인하거나 '미등원'을 눌러주세요.`);
        return false;
      }
    }

    // 2) 🔥 "센터 외 시간 활동" 라벨이 전부 입력되었는지 검증 (미등원 제외)
    const unlabeledReport = [];
    for (let d = 0; d < days.length; d++) {
      if (absentDays[d]) continue; // 미등원 요일은 제외
      const missing = getUnlabeledGapsForDay(d); // ["08:00~09:30", ...]
      if (missing.length > 0) {
        unlabeledReport.push(`${days[d]}: ${missing.join(", ")}`);
      }
    }

    if (unlabeledReport.length > 0) {
      alert(
        [
          "센터 외 시간 활동(빈구간) 입력이 비어 있습니다.",
          "아래 구간에 활동 내용을 입력해주세요:",
          "",
          ...unlabeledReport
        ].join("\n")
      );
      return false;
    }

    return true;
  };

  // ✅ 임시 저장 페이로드(검증 없이 현재 화면 원본까지 모두 포함)
  const buildDraftPayload = () => ({
    student_id: student?.id,
    weekStart,                // 이번 주 기준으로 임시 저장
    viewWeekStart,            // UI에서 보고 있는 주 (참고용)
    absentDays,               // 요일별 미등원 토글(그대로)
    scheduleRaw: schedule,    // HH/MM 분리값 포함한 원본 표
    gapLabelsRaw: gapLabels,  // 빈구간 라벨 원본
    // 안전하게 서버에서도 쓰도록, 정제본도 같이 전달(있으면 활용)
    normalized: {
      center: schedule.센터.map(getSortedValidBlocks), // 요일별 유효 블록(겹침/범위 정리됨)
      gaps: gapLabels.map((gaps) =>
        gaps
          .filter((g) => (g.label || "").trim())
          .map((g) => ({ start: g.start, end: g.end, label: g.label.trim() }))
      ),
    },
  });

  // ⏱️ 디바운스 큐
  const queueAutoSave = () => {
    if (!student?.id) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      await saveDraft();
    }, 1200); // 입력 후 1.2s 정지 시 저장
  };

  // 🚀 임시 저장 (검증 없이 저장)
  const saveDraft = async () => {
    if (!student?.id) return;
    try {
      setAutoSaveStatus("saving");
      const payload = buildDraftPayload();

      // 권장: draft 전용 엔드포인트
      await axios.post(`/student/schedules/draft`, payload);

      // 대안(엔드포인트 하나만 쓸 때):
      // await axios.post(`/student/schedules`, { ...payload, isDraft: true });

      setAutoSaveStatus("saved");
      const now = new Date();
      setLastAutoSaveAt(now);
      setTimeout(() => setAutoSaveStatus(""), 3000);
    } catch (e) {
      console.error("❌ 오토세이브 실패:", e);
      setAutoSaveStatus("error");
      setTimeout(() => setAutoSaveStatus(""), 5000);
    }
  };

  // 🧭 입력/토글이 변할 때마다 자동 임시저장(검증 없음)
  useEffect(() => {
    if (!student?.id || !weekStart) return;
    queueAutoSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, gapLabels, absentDays, student?.id, weekStart]);

  // 저장 (항상 "이번 주"로 저장!)
  const handleSave = async () => {
    if (!student?.id) {
      alert("학생 ID가 없습니다. 다시 로그인하세요.");
      navigate("/login");
      return;
    }

    // 👇 새 검증 추가
    setShowErrors(true); // ✅ 변경: 저장 시도 시 에러 하이라이트 ON
    if (!validateBeforeSave()) return;

    try {
      const allSchedules = [];

      // 센터(미등원 제외)
      schedule.센터.forEach((rows, dayIndex) => {
        if (absentDays[dayIndex]) return;
        const valid = getSortedValidBlocks(rows);
        valid.forEach((b) => {
          allSchedules.push({
            day: days[dayIndex],
            start: `${b.start}:${b.startMin}`,
            end: `${b.end}:${b.endMin}`,
            type: "센터",
            description: "",
          });
        });
      });

      // 빈구간(라벨 있는 것만, 미등원 제외) → ✅ 외부로 저장 + description에 라벨
      gapLabels.forEach((gaps, dayIndex) => {
        if (absentDays[dayIndex]) return;
        gaps.forEach((g) => {
          const label = (g.label || "").trim();
          if (label) {
            allSchedules.push({
              day: days[dayIndex],
              start: g.start,
              end: g.end,
              type: "외부",          // ✅ 관리 캘린더에서 바로 보이도록 외부로 저장
              description: label,    // ✅ 라벨 보존
            });
          }
        });
      });

      // ✅ 미등원 기록 추가
      absentDays.forEach((isAbsent, dayIndex) => {
        if (isAbsent) {
          allSchedules.push({
            day: days[dayIndex],
            start: "08:00",
            end: "08:00",
            type: "미등원",
            description: "미등원",
          });
        }
      });

      if (!allSchedules.length) {
        if (!confirm("입력된 일정이 없습니다. 빈 상태로 저장할까요?")) return;
      }

      setLoading(true);
      // 새 API(weekStart 포함) 우선
      try {
        // 🔥 저장 직전, 관리자 설정 주차 기준으로 강제 보정
        let fixedWeekStart = weekStart;
        if (settings.week_range_text) {
          const adminStartDate = parseAdminWeekStart(settings.week_range_text);
          if (adminStartDate) fixedWeekStart = toYmd(adminStartDate);
        }

        const res = await axios.post(`/student/schedules`, {
          student_id: student.id,
          weekStart: fixedWeekStart,   // ✅ 관리자 기준 주차로 저장
          schedules: allSchedules,
        });

        setLoading(false);
        if (res.data?.success) {
          alert("저장 완료!");
          setShowErrors(false); // ✅ 성공 시 에러 하이라이트 OFF
          setShowPrevWeekPrompt(false);

          // ✅ 저장한 주차(fixedWeekStart)로 즉시 동기화 (주차 불일치 방지)
          setViewWeekStart(fixedWeekStart);
          await loadWeek({ targetWeekStart: fixedWeekStart });

          await fetchRecentSaves();
          return;
        }

      } catch {
        // 폴백: 구 API
        const res2 = await axios.post(`/student/schedules`, {
          student_id: student.id,
          schedules: allSchedules,
        });
        setLoading(false);
        if (res2.data?.success) {
          alert("저장 완료!");
          setShowErrors(false); // ✅ 성공 시 에러 하이라이트 OFF
          setShowPrevWeekPrompt(false);
          setViewWeekStart(weekStart);
          await loadWeek({ targetWeekStart: weekStart });
          await fetchRecentSaves();
          return;
        }
        throw new Error("저장 실패");
      }
    } catch (e) {
      setLoading(false);
      console.error("❌ 저장 오류:", e);
      alert("저장에 실패했습니다.");
    }
  };

  // 지난주 동일 제출
  const handleSubmitSameAsPrev = async () => {
    if (!student?.id) return;
    try {
      setLoading(true);
      try {
        const res = await axios.post(`/student/schedules/copy-from-previous`, {
          student_id: student.id,
          weekStart,
          prevWeekStart,
        });
        setLoading(false);
        if (res.data?.success) {
          alert("지난주와 동일하게 제출되었습니다.");
          setShowPrevWeekPrompt(false);
          try { localStorage.setItem(samePromptKey, "1"); } catch {} // ✅ 이후 이 주차에서 배너 숨김
          setViewWeekStart(weekStart);
          await loadWeek({ targetWeekStart: weekStart });
          await fetchRecentSaves();
          return;
        }
      } catch {
        // 폴백
        const prev = await (async () => {
          try {
            const r = await axios.get(`/student/schedules/${student.id}?weekStart=${prevWeekStart}`);
            return r.data || [];
          } catch {
            const r2 = await axios.get(`/student/schedules/${student.id}`);
            return Array.isArray(r2.data) ? r2.data : [];
          }
        })();

        const prevForPost = prev.map((it) => ({
          day: it.day,
          start: it.start,
          end: it.end,
          type: it.type,
          description: it.description || "",
        }));

        try {
          const r3 = await axios.post(`/student/schedules`, {
            student_id: student.id,
            weekStart,
            schedules: prevForPost,
          });
          setLoading(false);
          if (r3.data?.success) {
            alert("지난주와 동일하게 제출되었습니다.");
            setShowPrevWeekPrompt(false);
            try { localStorage.setItem(samePromptKey, "1"); } catch {}
            setViewWeekStart(weekStart);
            await loadWeek({ targetWeekStart: weekStart });
            await fetchRecentSaves();
            return;
          }
        } catch {
          const r4 = await axios.post(`/student/schedules`, {
            student_id: student.id,
            schedules: prevForPost,
          });
          setLoading(false);
          if (r4.data?.success) {
            alert("지난주와 동일하게 제출되었습니다.");
            setShowPrevWeekPrompt(false);
            try { localStorage.setItem(samePromptKey, "1"); } catch {}
            setViewWeekStart(weekStart);
            await loadWeek({ targetWeekStart: weekStart });
            await fetchRecentSaves();
            return;
          }
          throw new Error("복사 저장 실패");
        }
      }
    } catch (err) {
      setLoading(false);
      console.error("❌ 지난주 동일 제출 실패:", err);
      alert("지난주 동일 제출에 실패했습니다.");
    }
  };

  // 지난주 불러와서 수정
  const handleLoadPrevToEdit = async () => {
    const res = await loadWeek({ targetWeekStart: prevWeekStart, preferPrevious: true });
    if (res?.ok) {
      setViewWeekStart(prevWeekStart);
      setShowPrevWeekPrompt(false); // ✅ 즉시 배너 닫기
      try { localStorage.setItem(samePromptKey, "1"); } catch {} // ✅ 이 주차에선 다시 안 보이게
    }
  };

  // 로그아웃
  const handleLogout = () => {
    try {
      localStorage.removeItem("student");
      localStorage.removeItem("token");
      localStorage.removeItem("studentToken");
      if (axios.defaults.headers.common.Authorization) delete axios.defaults.headers.common.Authorization;
    } catch {}
    navigate("/login");
  };

  // 미리보기 텍스트
  const buildPreviewText = () => {
    const byDayCenter = {};
    const byDayGaps = {};
    days.forEach((d, i) => {
      const centerBlocks = getSortedValidBlocks(schedule.센터[i]).map(
        (b) => `${b.start}:${b.startMin}~${b.end}:${b.endMin}`
      );
      if (centerBlocks.length) byDayCenter[d] = centerBlocks.join(", ");
      const gapParts = (gapLabels[i] || [])
        .filter((g) => (g.label || "").trim())
        .map((g) => `${g.start}~${g.end} ${g.label.trim()}`);
      if (gapParts.length) byDayGaps[d] = gapParts.join(", ");
    });
    const lines = [];
    lines.push(`[센터 일정] (${settings.week_range_text})`);
    Object.entries(byDayCenter).forEach(([d, v]) => lines.push(`${d}: ${v}`));
    if (Object.keys(byDayGaps).length) {
      lines.push("");
      lines.push("[센터 외 시간 활동]");
      Object.entries(byDayGaps).forEach(([d, v]) => lines.push(`${d}: ${v}`));
    }
    if (settings.notification_footer) {
      lines.push("");
      lines.push(settings.notification_footer);
    }
    return lines.join("\n");
  };

  const openPreview = (target = "student") => {
    setPreviewTarget(target);
    setPreviewText(buildPreviewText());
    setPreviewOpen(true);
  };

  const handleSendSms = async () => {
    try {
      const phone = previewTarget === "student" ? studentPhone : parentPhone;
      await axios.post(`/sms/send`, { to: phone, text: previewText });
      alert("✅ 문자 발송 성공!");
      setPreviewOpen(false);
    } catch (e) {
      console.error("❌ 문자 발송 오류:", e);
      alert("문자 발송 실패");
    }
  };

  // 🔵 라이브 캘린더용 아이템 계산(입력 즉시 반영)
  const liveCalendarItems = useMemo(() => {
    const items = [];
    days.forEach((d, idx) => {
      if (!absentDays[idx]) {
        // 센터
        getSortedValidBlocks(schedule.센터[idx]).forEach((b) => {
          items.push({
            day: d,
            start: `${b.start}:${b.startMin}`,
            end: `${b.end}:${b.endMin}`,
            type: "센터",
          });
        });
        // 외부(빈구간 라벨 입력된 것만 표시)
        (gapLabels[idx] || [])
          .filter((g) => (g.label || "").trim())
          .forEach((g) => {
            items.push({
              day: d,
              start: g.start,
              end: g.end,
              type: "외부",
            });
          });
      }
    });
    return items;
  }, [schedule, gapLabels, absentDays]);

  // ---- UI ----
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      {/* 상단 바: 제목 + 주 라벨 + 로그아웃 */}
      <div className="mb-4 md:mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">주간 일정 입력</h1>
        <div className="text-xs md:text-sm text-gray-600 mt-1">
            표시 중: {isViewingPrev ? "지난주" : "이번주"} ({viewWeekStart})
          </div>
          {settings.week_range_text && (
            <p className="text-xs md:text-sm text-gray-500">공지: {settings.week_range_text}</p>
          )}
        </div>
        <button
          onClick={handleLogout}
          className="shrink-0 border px-3 py-1.5 rounded-md text-sm hover:bg-gray-50"
          title="로그아웃"
        >
          로그아웃
        </button>
      </div>

      {/* 지난주/이번주 전환 버튼 */}
      <div className="mb-4 flex flex-col sm:flex-row gap-2">
        <button
          onClick={async () => {
            setViewWeekStart(prevWeekStart);
            await loadWeek({ targetWeekStart: prevWeekStart, preferPrevious: true });
          }}
          className="border px-3 py-2 rounded text-sm hover:bg-gray-50"
        >
          지난주 일정 불러오기
        </button>
        <button
          onClick={async () => {
            setViewWeekStart(weekStart);
            await loadWeek({ targetWeekStart: weekStart });
          }}
          className="border px-3 py-2 rounded text-sm hover:bg-gray-50"
        >
          이번주로 되돌리기
        </button>
        <div className="text-xs text-gray-500 self-center">
          * 저장하기를 누르면 항상 이번 주({weekStart})로 저장됩니다.
        </div>
      </div>

      {/* 지난주 동일 배너 (있을 때만) */}
      {showPrevWeekPrompt && hasPrevWeek && (
        <div className="mb-4 p-3 md:p-4 border rounded-xl bg-amber-50">
          <div className="font-medium mb-2">지난주와 일정이 동일한가요?</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={handleSubmitSameAsPrev}
              className="px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "제출 중..." : "네, 지난주와 동일하게 제출"}
            </button>
            <button
              onClick={handleLoadPrevToEdit}
              className="px-3 py-2 text-sm rounded border hover:bg-gray-50"
              disabled={loading}
            >
              아니요, 수정해서 제출할게요
            </button>
          </div>
          <div className="text-xs text-gray-600 mt-2">
            ※ “수정해서 제출”을 누르면 지난주 일정이 아래 입력란에 채워집니다.
          </div>
        </div>
      )}

      {/* 센터 안내문 */}
      {(settings.center_desc || settings.center_example) && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 md:p-4 mb-4">
          {settings.center_desc && (
            <p className="text-sm md:text-base whitespace-pre-line">{settings.center_desc}</p>
          )}
          {settings.center_example && (
            <div className="mt-2 text-xs md:text-sm text-gray-600 whitespace-pre-line">
              예시) {settings.center_example}
            </div>
          )}
        </div>
      )}

      {/* 입력 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {days.map((day, dayIdx) => {
          const rows = schedule.센터[dayIdx];
          const gaps = computeGaps(rows);
          const disabled = absentDays[dayIdx];
          return (
            <div key={day} className="border rounded-2xl shadow-sm p-3 md:p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-base md:text-lg">
                  {day} ({formatMD(weekDates[dayIdx])})
                </h2>
                <button
                  type="button"
                  onClick={() => toggleAbsent(dayIdx)}
                  className={`text-xs px-2 py-1 rounded border ${
                    disabled ? "bg-gray-200" : "hover:bg-gray-50"
                  }`}
                  title="해당 요일을 미등원 처리합니다"
                >
                  {disabled ? "미등원 해제" : "미등원"}
                </button>
              </div>

              {/* 센터 블록 표 (HH / MM 분리 입력) */}
              <div className={`space-y-2 ${disabled ? "opacity-60 pointer-events-none select-none" : ""}`}>
                {rows.map((row, rowIdx) => {
                  const errs = getCenterRowErrors(dayIdx, rowIdx); // ✅ 추가
                  return (
                    <div key={rowIdx} className="flex flex-wrap items-center gap-2">
                      {/* 시작 HH */}
                      <input
                        type="text"
                        inputMode="numeric"
                        className={`border rounded px-2 py-1 text-sm w-16 ${errs.start ? "border-red-500 ring-1 ring-red-500" : ""}`} // ✅ 변경(하이라이트)
                        placeholder="11"
                        maxLength={2}
                        value={row.start}
                        onChange={(e) => updateCell(dayIdx, rowIdx, "start", e.target.value)}
                        disabled={disabled}
                      />
                      {/* 시작 MM */}
                      <input
                        type="text"
                        inputMode="numeric"
                        className={`border rounded px-2 py-1 text-sm w-16 ${errs.startMin ? "border-red-500 ring-1 ring-red-500" : ""}`} // ✅ 변경
                        placeholder="00"
                        maxLength={2}
                        value={row.startMin}
                        onChange={(e) => updateCell(dayIdx, rowIdx, "startMin", e.target.value)}
                        disabled={disabled}
                      />
                      <span className="text-sm">~</span>
                      {/* 종료 HH */}
                      <input
                        type="text"
                        inputMode="numeric"
                        className={`border rounded px-2 py-1 text-sm w-16 ${errs.end ? "border-red-500 ring-1 ring-red-500" : ""}`} // ✅ 변경
                        placeholder="19"
                        maxLength={2}
                        value={row.end}
                        onChange={(e) => updateCell(dayIdx, rowIdx, "end", e.target.value)}
                        disabled={disabled}
                      />
                      {/* 종료 MM */}
                      <input
                        type="text"
                        inputMode="numeric"
                        className={`border rounded px-2 py-1 text-sm w-16 ${errs.endMin ? "border-red-500 ring-1 ring-red-500" : ""}`} // ✅ 변경
                        placeholder="30"
                        maxLength={2}
                        value={row.endMin}
                        onChange={(e) => updateCell(dayIdx, rowIdx, "endMin", e.target.value)}
                        disabled={disabled}
                      />

                      <button
                        onClick={() => removeRow(dayIdx, rowIdx)}
                        className="text-xs border px-2 py-1 rounded hover:bg-gray-50"
                        disabled={disabled}
                      >
                        삭제
                      </button>
                    </div>
                  );
                })}
                <div>
                  <button
                    onClick={() => addRow(dayIdx)}
                    className="mt-1 text-xs border px-2 py-1 rounded hover:bg-gray-50"
                    disabled={disabled}
                  >
                    + 구간 추가
                  </button>
                </div>
              </div>

              {/* 빈 구간 활동 입력 */}
              <div className="mt-3 border-t pt-3">
                <div className="text-sm font-medium mb-1">센터 외 시간 활동</div>
                {disabled ? (
                  <div className="text-xs text-gray-500">미등원 처리된 요일입니다.</div>
                ) : gapLabels[dayIdx] && gapLabels[dayIdx].length > 0 ? (
                  gapLabels[dayIdx].map((g, i) => {
                    const needLabel = showErrors && ((g.label || "").trim() === ""); // ✅ 추가: 미입력 하이라이트
                    return (
                      <div key={i} className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-xs text-gray-600 w-24">
                          {g.start}~{g.end}
                        </span>
                        <input
                          type="text"
                          className={`border rounded px-2 py-1 text-sm flex-1 ${needLabel ? "border-red-500 ring-1 ring-red-500" : ""}`} // ✅ 변경
                          placeholder="예: 학교 / PMG 과학 학원 / 휴식"
                          value={g.label || ""}
                          onChange={(e) => setGapLabel(dayIdx, i, e.target.value)}
                        />
                      </div>
                    );
                  })
                ) : (
                  <div className="text-xs text-gray-500">센터 시간을 입력하면 자동으로 생성됩니다.</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 하단 액션 */}
      <div className="mt-6 flex flex-col md:flex-row gap-3 md:items-center">
        <button
          onClick={handleSave}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "저장 중..." : "저장하기"}
        </button>

        {/* ✅ 오토세이브 상태 표시 */}
        <div className="text-xs text-gray-500">
          {autoSaveStatus === "saving" && "자동저장 중..."}
          {autoSaveStatus === "saved" && lastAutoSaveAt && `자동저장됨 ${lastAutoSaveAt.toLocaleTimeString()}`}
          {autoSaveStatus === "error" && <span className="text-red-600">자동저장 실패</span>}
        </div>

        <div className="flex-1" />

        {/* 문자 미리보기/발송 */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="flex gap-2">
            <input
              type="tel"
              className="border rounded px-2 py-1 text-sm"
              placeholder="학생 번호"
              value={studentPhone}
              onChange={(e) => setStudentPhone(e.target.value)}
            />
            <button
              onClick={() => openPreview("student")}
              className="border px-3 py-1 rounded text-sm hover:bg-gray-50"
            >
              문자 전송하기
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="tel"
              className="border rounded px-2 py-1 text-sm"
              placeholder="보호자 번호"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
            />
            <button
              onClick={() => openPreview("parent")}
              className="border px-3 py-1 rounded text-sm hover:bg-gray-50"
            >
              문자 전송하기
            </button>
          </div>
        </div>
      </div>

      {/* 🔵 실시간 주간 캘린더 (입력 즉시 반영) */}
      <LiveWeekCalendar
        weekStartYmd={weekStart}          // 저장 기준 주(월요일)로 라벨링
        items={liveCalendarItems}         // 센터 + 외부(빈구간 라벨)
        title="실시간 캘린더 미리보기 (센터/외부)"
      />

      {/* 문자 발송 모달 */}
      {previewOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-4 w-full max-w-md shadow-lg">
            <h2 className="text-lg font-semibold mb-3">문자 발송 미리보기</h2>
            <textarea readOnly className="w-full h-48 border p-2 rounded text-sm mb-3" value={previewText} />
            <div className="flex justify-end gap-2">
              <button className="border px-3 py-1 rounded text-sm hover:bg-gray-50" onClick={() => setPreviewOpen(false)}>
                닫기
              </button>
              <button
                onClick={handleSendSms}
                className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
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
