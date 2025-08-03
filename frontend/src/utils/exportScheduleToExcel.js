// frontend/src/utils/exportScheduleToExcel.js
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

// 요일 정렬 기준(월~일)
const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
const dayRank = (d) => {
  const idx = DAY_ORDER.indexOf(d ?? "");
  return idx === -1 ? 99 : idx;
};

// 공통: 엑셀 작성+다운로드
function writeAndDownloadXlsx(aoa, sheetName, filenamePrefix) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const today = new Date();
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `${filenamePrefix}_${yyyymmdd}.xlsx`;

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/octet-stream" });
  saveAs(blob, filename);
}

/**
 * (개인용 - 기존 유지)
 * 입력: scheduleByDay[요일] -> [{ startHour, startMinute, endHour, endMinute, description }]
 */
export function exportScheduleToExcel(scheduleByDay, filenamePrefix) {
  const rows = [];

  for (const day of ["월", "화", "수", "목", "금", "토"]) {
    const entries = scheduleByDay[day] || [];
    for (const entry of entries) {
      const start = `${entry.startHour}:${entry.startMinute}`;
      const end = `${entry.endHour}:${entry.endMinute}`;
      const description = entry.description || "";
      rows.push([day, start, end, description]);
    }
  }

  const aoa = [["요일", "시작시간", "종료시간", "설명"], ...rows];
  writeAndDownloadXlsx(aoa, "일정", filenamePrefix);
}

/* =========================
 *  관리자용: 가로 템플릿 생성
 *  학생 1명 = 1행, 요일별 칸에 "HH:MM~HH:MM, ..." 형식으로 채움
 * ========================= */
function buildWideTemplateAoA({
  title,
  type,
  items,
  students,
  includeSunday = true, // ✅ 기본값을 true로(일요일 포함)
}) {
  const DAYS = includeSunday ? ["월", "화", "수", "목", "금", "토", "일"] : ["월", "화", "수", "목", "금", "토"];

  // 학생별 기본 정보 맵
  const nameById = new Map((students || []).map((s) => [s.id, s.name]));
  const seatById = new Map((students || []).map((s) => [s.id, s.seatNumber ?? s.seat ?? ""]));
  const phoneById = new Map((students || []).map((s) => [s.id, s.studentPhone ?? ""]));

  // 학생별, 요일별 구간 수집용 구조
  const byStudent = new Map();
  for (const s of students || []) {
    byStudent.set(s.id, {
      id: s.id,
      name: s.name,
      seat: seatById.get(s.id) || "",
      phone: phoneById.get(s.id) || "",
      days: Object.fromEntries(DAYS.map((d) => [d, []])),
    });
  }

  // 해당 type(외부/센터)만 반영하여 날짜별 시간대 채우기
  (items || [])
    .filter((it) => (it?.type || "") === type)
    .forEach((it) => {
      const target = byStudent.get(it.student_id);
      if (!target) return; // 학생 목록에 없으면 스킵
      const d = it.day;
      if (!target.days[d]) return;

      const start = (it.start || "").padStart(5, "0"); // "HH:MM"
      const end = (it.end || "").padStart(5, "0");

      // 외부 일정 메모를 요일 칸에 붙이고 싶다면 아래 주석 해제
      // const text = type === "외부" && it.description ? `${start}~${end} (${it.description})` : `${start}~${end}`;
      const text = `${start}~${end}`; // ✅ 템플릿에는 시간만
      target.days[d].push(text);
    });

  // 요일 시간대 문자열 정렬/병합
  const mergeDay = (arr) => {
    const withNum = arr.map((t) => {
      const startHHMM = t.split("~")[0].replace(":", "");
      return { t, n: Number(startHHMM) };
    });
    withNum.sort((a, b) => a.n - b.n);
    return withNum.map((x) => x.t).join(", ");
  };

  // A1 제목행 + A2 헤더 구성
  const aoa = [];
  aoa.push([title]); // A1
  aoa.push(["이름", "좌석번호", "전화번호", ...DAYS]); // A2

  // ✅ 학생 목록을 이름 기준으로 정렬(한글 정렬 정확도 보강)
  const sortedStudents = [...(students || [])].sort((a, b) =>
    (a?.name || "").localeCompare((b?.name || ""), "ko")
  );

  // 학생 목록 기준으로 행 생성 (스케줄이 없어도 행은 출력)
  for (const s of sortedStudents) {
    const rowBase = byStudent.get(s.id) || {
      id: s.id,
      name: s.name,
      seat: seatById.get(s.id) || "",
      phone: phoneById.get(s.id) || "",
      days: Object.fromEntries(DAYS.map((d) => [d, []])),
    };

    const row = [
      rowBase.name || "",
      rowBase.seat || "",
      rowBase.phone || "",
      ...DAYS.map((d) => (rowBase.days[d].length ? mergeDay(rowBase.days[d]) : "")),
    ];
    aoa.push(row);
  }

  return aoa;
}

/**
 * (관리자용) 외부 일정 가로 템플릿 엑셀
 * @param {Array} items    [{ student_id, day, start, end, type:"외부", description? }, ...]
 * @param {Array} students [{ id, name, seatNumber?, seat?, studentPhone? }, ...]
 * @param {String} filenamePrefix  기본 파일명 접두사 (예: "외부일정")
 * @param {Object} opts    { rangeText?: string, includeSunday?: boolean }
 */
export function exportExternalSchedulesToExcel(
  items,
  students,
  filenamePrefix = "외부일정",
  opts = {}
) {
  const title = `외부 일정 입력 ${opts.rangeText ? `(${opts.rangeText})` : ""}`.trim();
  const aoa = buildWideTemplateAoA({
    title,
    type: "외부",
    items,
    students,
    includeSunday: opts.includeSunday ?? true, // ✅ 기본 true
  });
  writeAndDownloadXlsx(aoa, "외부일정", filenamePrefix);
}

/**
 * (관리자용) 센터 일정 가로 템플릿 엑셀
 * @param {Array} items    [{ student_id, day, start, end, type:"센터" }, ...]
 * @param {Array} students [{ id, name, seatNumber?, seat?, studentPhone? }, ...]
 * @param {String} filenamePrefix  기본 파일명 접두사 (예: "센터일정")
 * @param {Object} opts    { rangeText?: string, includeSunday?: boolean }
 */
export function exportCenterSchedulesToExcel(
  items,
  students,
  filenamePrefix = "센터일정",
  opts = {}
) {
  const title = `센터 일정 입력 ${opts.rangeText ? `(${opts.rangeText})` : ""}`.trim();
  const aoa = buildWideTemplateAoA({
    title,
    type: "센터",
    items,
    students,
    includeSunday: opts.includeSunday ?? true, // ✅ 기본 true
  });
  writeAndDownloadXlsx(aoa, "센터일정", filenamePrefix);
}
