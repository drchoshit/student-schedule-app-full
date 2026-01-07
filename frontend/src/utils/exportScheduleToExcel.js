import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

// 요일 정렬 기준(월~일)
const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
const dayRank = (d) => {
  const idx = DAY_ORDER.indexOf(typeof d === "string" ? d : "");
  return idx === -1 ? 99 : idx;
};

// ─────────────────────────────────────────────────────────────
// 타입 정규화
// ─────────────────────────────────────────────────────────────
function normalizeType(t) {
  const v = (t ?? "").toString().trim().toLowerCase();
  if (v === "센터" || v === "center") return "센터";
  if (v === "외부" || v === "external" || v === "원외") return "외부";
  return (t ?? "").toString().trim();
}

// ─────────────────────────────────────────────────────────────
// 최신 제출만 사용
// ─────────────────────────────────────────────────────────────
function pickLatestItems(items) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const hasSavedAt = items.some((x) => x?.saved_at);
  const hasWeekStart = items.some((x) => x?.week_start);

  if (!hasSavedAt && !hasWeekStart) return items;

  const latestKeyByStudent = new Map();

  for (const it of items) {
    const sid = it?.student_id ?? it?.studentId ?? it?.id;
    if (!sid) continue;

    const key = hasSavedAt
      ? String(it?.saved_at || "")
      : String(it?.week_start || "");

    const prev = latestKeyByStudent.get(sid);
    if (!prev || key > prev) {
      latestKeyByStudent.set(sid, key);
    }
  }

  return items.filter((it) => {
    const sid = it?.student_id ?? it?.studentId ?? it?.id;
    if (!sid) return false;

    const key = hasSavedAt
      ? String(it?.saved_at || "")
      : String(it?.week_start || "");

    return latestKeyByStudent.get(sid) === key;
  });
}

// ─────────────────────────────────────────────────────────────
// 공통 엑셀 생성
// ─────────────────────────────────────────────────────────────
function writeAndDownloadXlsx(aoa, sheetName, filenamePrefix) {
  const safePrefix = typeof filenamePrefix === "string" && filenamePrefix.trim()
    ? filenamePrefix.trim()
    : "export";

  const ws = XLSX.utils.aoa_to_sheet(Array.isArray(aoa) ? aoa : [[]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || "Sheet1");

  const today = new Date();
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `${safePrefix}_${yyyymmdd}.xlsx`;

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/octet-stream" });
  saveAs(blob, filename);
}

/**
 * 개인용 (기존 유지)
 */
export function exportScheduleToExcel(scheduleByDay, filenamePrefix) {
  const rows = [];

  for (const day of ["월", "화", "수", "목", "금", "토"]) {
    const entries = Array.isArray(scheduleByDay?.[day]) ? scheduleByDay[day] : [];
    for (const entry of entries) {
      const start = `${entry?.startHour ?? ""}:${entry?.startMinute ?? ""}`;
      const end = `${entry?.endHour ?? ""}:${entry?.endMinute ?? ""}`;
      const description = entry?.description ?? "";
      rows.push([day, start, end, description]);
    }
  }

  const aoa = [["요일", "시작시간", "종료시간", "설명"], ...rows];
  writeAndDownloadXlsx(aoa, "일정", filenamePrefix);
}

// ─────────────────────────────────────────────────────────────
// 관리자용 가로 템플릿
// ─────────────────────────────────────────────────────────────
function buildWideTemplateAoA({
  title,
  type,
  items,
  students,
  includeSunday = true,
}) {
  const DAYS = includeSunday
    ? ["월", "화", "수", "목", "금", "토", "일"]
    : ["월", "화", "수", "목", "금", "토"];

  const latestItems = pickLatestItems(items).map((x) => ({
    ...x,
    type: normalizeType(x?.type),
  }));

  const safeStudents = Array.isArray(students) ? students : [];

  const byStudent = new Map();
  for (const s of safeStudents) {
    byStudent.set(s.id, {
      name: s.name || "",
      seat: s.seatNumber ?? s.seat ?? "",
      phone: s.studentPhone ?? "",
      days: Object.fromEntries(DAYS.map((d) => [d, new Set()])),
    });
  }

  latestItems
    .filter((it) => normalizeType(it?.type) === type)
    .forEach((it) => {
      const sid = it?.student_id ?? it?.studentId ?? it?.id;
      const target = byStudent.get(sid);
      if (!target) return;

      const d = it?.day;
      if (!target.days[d]) return;

      const start = String(it?.start ?? "").padStart(5, "0");
      const end = String(it?.end ?? "").padStart(5, "0");

      if (!start || !end) return;
      target.days[d].add(`${start}~${end}`);
    });

  const mergeDay = (setObj) =>
    Array.from(setObj || [])
      .map((t) => ({
        t,
        n: Number(t.split("~")[0].replace(":", "")),
      }))
      .sort((a, b) => a.n - b.n)
      .map((x) => x.t)
      .join(", ");

  const aoa = [];
  aoa.push([typeof title === "string" ? title : ""]);
  aoa.push(["이름", "좌석번호", "전화번호", ...DAYS]);

  const sortedStudents = [...safeStudents].sort((a, b) =>
    (a?.name || "").localeCompare((b?.name || ""), "ko")
  );

  for (const s of sortedStudents) {
    const rowBase = byStudent.get(s.id);
    aoa.push([
      rowBase?.name ?? "",
      rowBase?.seat ?? "",
      rowBase?.phone ?? "",
      ...DAYS.map((d) =>
        rowBase?.days?.[d]?.size ? mergeDay(rowBase.days[d]) : ""
      ),
    ]);
  }

  return aoa;
}

// ─────────────────────────────────────────────────────────────
// 외부 일정
// ─────────────────────────────────────────────────────────────
export function exportExternalSchedulesToExcel(
  items,
  students,
  filenamePrefix = "외부일정",
  opts = {}
) {
  const rangeText =
    typeof opts?.rangeText === "string" ? opts.rangeText : "";

  const title = `외부 일정 입력${rangeText ? ` (${rangeText})` : ""}`;

  const aoa = buildWideTemplateAoA({
    title,
    type: "외부",
    items,
    students,
    includeSunday: opts?.includeSunday ?? true,
  });

  writeAndDownloadXlsx(aoa, "외부일정", filenamePrefix);
}

// ─────────────────────────────────────────────────────────────
// 센터 일정
// ─────────────────────────────────────────────────────────────
export function exportCenterSchedulesToExcel(
  items,
  students,
  filenamePrefix = "센터일정",
  opts = {}
) {
  const rangeText =
    typeof opts?.rangeText === "string" ? opts.rangeText : "";

  const title = `센터 일정 입력${rangeText ? ` (${rangeText})` : ""}`;

  const aoa = buildWideTemplateAoA({
    title,
    type: "센터",
    items,
    students,
    includeSunday: opts?.includeSunday ?? true,
  });

  writeAndDownloadXlsx(aoa, "센터일정", filenamePrefix);
}
