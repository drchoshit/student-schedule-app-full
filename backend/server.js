import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import multer from "multer";
import { parse } from "csv-parse/sync";
import dayjs from "dayjs";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import { all, get, run } from "./db.js";
import crypto from "crypto";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 5000;

/* ===============================
   App & Middlewares
   =============================== */

// ✅ 프록시(Render 등) 뒤에서 Secure 쿠키 신뢰
app.set("trust proxy", 1);

// ===============================
// CORS 최소 설정
// 운영: 같은 도메인(/api 상대경로) → CORS 거의 영향 없음
// 개발: vite dev 서버(5173)에서만 허용 필요
// ===============================
const allowList = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);            // 서버 내부 호출 등
      if (allowList.includes(origin)) return cb(null, true);
      return cb(null, false);                        // 불허
    },
    credentials: true,                               // ✅ 쿠키 전달 허용
  })
);

app.use(express.json({ limit: "2mb" }));

/* ===============================
   Admin Auth (cookie)
   =============================== */

const ADMIN_USER = process.env.ADMIN_USER || "medicalsoap";
const ADMIN_PASS = process.env.ADMIN_PASS || "ghfkdskql2827";
const ADMIN_SECRET =
  process.env.ADMIN_SECRET ||
  "please-change-this-admin-cookie-secret-very-long";
const ADMIN_COOKIE_NAME = "admintoken";
const IS_PROD = process.env.NODE_ENV === "production";

// 배포환경(크로스 도메인 쿠키) 대비 쿠키 옵션
const COOKIE_SAMESITE = IS_PROD ? "none" : "lax";
const COOKIE_SECURE = IS_PROD ? true : false;
// 같은 최상위 도메인으로만 묶고 싶을 때 설정(예: .medieats.kr). 필요 없으면 미설정
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

app.use(cookieParser(ADMIN_SECRET));

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });
  }
  res.cookie(ADMIN_COOKIE_NAME, "1", {
    httpOnly: true,
    sameSite: COOKIE_SAMESITE,     // production이면 "none"
    secure: COOKIE_SECURE,         // production이면 true
    signed: true,
    path: "/",
    domain: COOKIE_DOMAIN || undefined,  // ← undefined면 현재 호스트 도메인 자동 적용
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
  return res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  const token = req.signedCookies?.[ADMIN_COOKIE_NAME];
  return res.json({ authenticated: token === "1" });
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: COOKIE_SAMESITE,
    secure: COOKIE_SECURE,
    signed: true,
    path: "/",
    domain: COOKIE_DOMAIN,
  });
  return res.json({ ok: true });
});

function adminAuth(req, res, next) {
  const open = ["/login", "/me", "/logout"];
  if (open.includes(req.path)) return next();
  const token = req.signedCookies?.[ADMIN_COOKIE_NAME];
  if (token === "1") return next();
  return res.status(401).json({ error: "UNAUTHORIZED" });
}
app.use("/api/admin", adminAuth);

/* ===============================
   Uploads
   =============================== */
const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOAD_DIR));

// temp for excel
const TMP_DIR = path.join(UPLOAD_DIR, "tmp");
fs.mkdirSync(TMP_DIR, { recursive: true });
const uploadExcel = multer({ dest: TMP_DIR });

/* ===============================
   DB Migration (sms_extra_text 자동)
   =============================== */
(async () => {
  try {
    const cols = await all("PRAGMA table_info(policy)");
    const hasCol = cols.some((c) => c.name === "sms_extra_text");
    if (!hasCol) {
      await run("ALTER TABLE policy ADD COLUMN sms_extra_text TEXT");
      console.log("DB migrated: sms_extra_text column added to policy table");
    }
  } catch (e) {
    console.error("DB migration check failed:", e);
  }
})();

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ===============================
   Helpers for Excel header/phone
   =============================== */
const onlyDigits = (s = "") => String(s).replace(/\D/g, "");

function normalizePhone(raw = "") {
  const digits = onlyDigits(raw);
  if (digits.length === 11 && digits.startsWith("010")) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return String(raw || "");
}

function headerKey(h) {
  const s = String(h).trim().toLowerCase();

  if (/(^|[^가-힣a-z])이름([^가-힣a-z]|$)/.test(s) || /(^|_)name($|_)/.test(s))
    return "name";

  if (/(^|[^가-힣a-z])코드([^가-힣a-z]|$)/.test(s) || /(code|id)\b/.test(s))
    return "code";

  if (
    /학생.?연락/.test(s) ||
    /(student.*(phone|tel)|phone_student|학생전화)/.test(s)
  )
    return "studentPhone";

  if (
    /(학부모|보호자).?연락/.test(s) ||
    /(parent.*(phone|tel)|phone_parent|보호자전화)/.test(s)
  )
    return "parentPhone";

  return null;
}

/**
 * 엑셀 버퍼를 받아 학생 목록으로 변환(헤더 자동 탐지)
 */
function parseExcelBufferToStudents(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (!rows.length) return [];

  let headerIdx = -1;
  let headerKeys = [];
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const ks = rows[i].map(headerKey);
    const score = ks.filter(Boolean).length;
    if (score >= 2 && (ks.includes("name") || ks.includes("code"))) {
      headerIdx = i;
      headerKeys = ks;
      break;
    }
  }
  if (headerIdx < 0) {
    headerIdx = 0;
    headerKeys = rows[0].map(headerKey);
  }

  const out = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const obj = { name: "", code: "", studentPhone: "", parentPhone: "" };
    for (let c = 0; c < Math.max(headerKeys.length, row.length); c++) {
      const k = headerKeys[c];
      if (!k) continue;
      let v = row[c];
      if (k === "studentPhone" || k === "parentPhone") v = normalizePhone(v);
      obj[k] = String(v ?? "").trim();
    }
    if (obj.name || obj.code || obj.studentPhone || obj.parentPhone)
      out.push(obj);
  }
  return out;
}

/* ===============================
   Students: import/export & CRUD
   =============================== */

// CSV import (기존 유지)
app.post(
  "/api/admin/students/import",
  express.text({ type: "text/csv" }),
  async (req, res) => {
    const records = parse(req.body, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    for (const r of records) {
      await run(
        `INSERT INTO students(code,name,allowed_weekdays,start_date,end_date,price_override)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(code) DO UPDATE SET
           name=excluded.name,
           allowed_weekdays=excluded.allowed_weekdays,
           start_date=excluded.start_date,
           end_date=excluded.end_date,
           price_override=excluded.price_override`,
        [
          r.code,
          r.name,
          r.allowed_weekdays,
          r.start_date,
          r.end_date,
          r.price_override,
        ]
      );
    }
    res.json({ imported: records.length });
  }
);

// 엑셀 미리보기(파싱만)
app.post(
  "/api/admin/students/preview-excel",
  uploadExcel.single("file"),
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ ok: false, error: "FILE_REQUIRED" });
      const buf = fs.readFileSync(req.file.path);
      const students = parseExcelBufferToStudents(buf);
      fs.unlink(req.file.path, () => {});
      return res.json({ ok: true, students });
    } catch (e) {
      console.error(e);
      return res
        .status(500)
        .json({ ok: false, error: String(e?.message || e) });
    }
  }
);

// 엑셀 → DB 추가(신규만) (기존 유지)
app.post(
  "/api/admin/students/import-excel",
  uploadExcel.single("file"),
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ ok: false, error: "FILE_REQUIRED" });

      const buf = fs.readFileSync(req.file.path);
      const parsed = parseExcelBufferToStudents(buf);

      const existing = await all("SELECT name, code FROM students");
      const byCode = new Map(
        existing.map((s) => [
          String(s.code || "").trim(),
          { name: String(s.name || "").trim() },
        ])
      );
      const byNameCode = new Set(
        existing.map(
          (s) =>
            `${String(s.name || "").trim()}|${String(s.code || "").trim()}`
        )
      );

      let imported = 0;
      const skipped_existing = [];
      const skipped_code_conflict = [];

      for (const r of parsed) {
        const name = String(r.name || "").trim();
        const code = String(r.code || "").trim();
        const phone = String(r.studentPhone || "").trim();
        const parent_phone = String(r.parentPhone || "").trim();
        if (!name || !code) continue;

        const key = `${name}|${code}`;
        if (byNameCode.has(key)) {
          skipped_existing.push({ name, code });
          continue;
        }
        const prev = byCode.get(code);
        if (prev && prev.name && prev.name !== name) {
          skipped_code_conflict.push({ name, code, exists_as: prev.name });
          continue;
        }

        await run(
          "INSERT INTO students(name, code, phone, parent_phone) VALUES(?,?,?,?)",
          [name, code, phone, parent_phone]
        );
        imported++;
        byCode.set(code, { name });
        byNameCode.add(key);
      }

      fs.unlink(req.file.path, () => {});
      return res.json({
        ok: true,
        imported,
        skipped_existing,
        skipped_code_conflict,
      });
    } catch (e) {
      console.error(e);
      return res
        .status(500)
        .json({ ok: false, error: String(e?.message || e) });
    }
  }
);

// 엑셀 내보내기 (사용자 포맷)
app.get("/api/admin/students/export-excel", async (_req, res) => {
  try {
    const rows = await all(
      "SELECT name, code, phone, parent_phone FROM students ORDER BY name"
    );
    const data = rows.map((r) => ({
      ID: r.code,
      이름: r.name,
      학년: "",
      학생전화: r.phone || "",
      보호자전화: r.parent_phone || "",
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "학생DB");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="students.xlsx"`
    );
    return res.send(buf);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 목록
app.get("/api/admin/students", async (_req, res) =>
  res.json(await all("SELECT * FROM students ORDER BY name"))
);

// 단건 upsert
app.post("/api/admin/students", async (req, res) => {
  const { name, code, phone, parent_phone } = req.body || {};
  if (!name || !code) {
    return res
      .status(400)
      .json({ ok: false, error: "NAME_AND_CODE_REQUIRED" });
  }
  await run(
    `INSERT INTO students(name, code, phone, parent_phone)
     VALUES(?,?,?,?)
     ON CONFLICT(code) DO UPDATE SET
       name=excluded.name,
       phone=excluded.phone,
       parent_phone=excluded.parent_phone`,
    [name.trim(), code.trim(), (phone || "").trim(), (parent_phone || "").trim()]
  );
  res.json({ ok: true });
});

// 수정
app.put("/api/admin/students/:id", async (req, res) => {
  const { id } = req.params;
  const { name, code, phone, parent_phone } = req.body || {};
  await run(
    "UPDATE students SET name=?, code=?, phone=?, parent_phone=? WHERE id=?",
    [name, code, phone || "", parent_phone || "", id]
  );
  res.json({ ok: true });
});

// 삭제
app.delete("/api/admin/students/:id", async (req, res) => {
  const { id } = req.params;
  await run("DELETE FROM students WHERE id=?", [id]);
  res.json({ ok: true });
});

// CSV export (기존 유지)
app.get("/api/admin/students/export", async (_req, res) => {
  const rows = await all(
    "SELECT name, code, phone, parent_phone FROM students ORDER BY name"
  );
  const header = "name,code,phone,parent_phone\n";
  const body =
    rows
      .map((r) =>
        [r.name, r.code, r.phone || "", r.parent_phone || ""]
          .map((v) => `"${String(v).replaceAll(`"`, `""`)}"`)
          .join(",")
      )
      .join("\n") + "\n";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="students.csv"');
  res.send(header + body);
});

// 전체 저장(일괄 upsert)
app.post("/api/admin/students/bulk-upsert", async (req, res) => {
  const list = Array.isArray(req.body?.students) ? req.body.students : [];
  if (!list.length) return res.json({ ok: true, inserted: 0, updated: 0 });

  try {
    let inserted = 0;
    let updated = 0;

    for (const raw of list) {
      const name = String(raw.name || "").trim();
      const code = String(raw.code || "").trim();
      const phone = String(raw.phone || "").trim();
      const parent_phone = String(raw.parent_phone || "").trim();
      if (!name || !code) continue;

      const prev = await get("SELECT id FROM students WHERE code=?", [code]);

      await run(
        `INSERT INTO students(name, code, phone, parent_phone)
         VALUES(?,?,?,?)
         ON CONFLICT(code) DO UPDATE SET
           name=excluded.name,
           phone=excluded.phone,
           parent_phone=excluded.parent_phone`,
        [name, code, phone, parent_phone]
      );

      if (prev) updated++;
      else inserted++;
    }

    return res.json({ ok: true, inserted, updated });
  } catch (e) {
    return res.status(400).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
});

/* ===============================
   Global Policy
   =============================== */

app.get("/api/admin/policy", async (_req, res) =>
  res.json(await get("SELECT * FROM policy WHERE id=1"))
);

app.post("/api/admin/policy", async (req, res) => {
  const {
    base_price,
    allowed_weekdays,
    start_date,
    end_date,
    sms_extra_text,
  } = req.body || {};
  await run(
    "UPDATE policy SET base_price=?, allowed_weekdays=?, start_date=?, end_date=?, sms_extra_text=? WHERE id=1",
    [base_price, allowed_weekdays, start_date, end_date, sms_extra_text ?? null]
  );
  res.json({ ok: true });
});

// Per-student policy override
app.post("/api/admin/student-policy/:id", async (req, res) => {
  const { id } = req.params;
  const { allowed_weekdays, start_date, end_date, price_override } =
    req.body || {};
  await run(
    "UPDATE students SET allowed_weekdays=?, start_date=?, end_date=?, price_override=? WHERE id=?",
    [
      allowed_weekdays || null,
      start_date || null,
      end_date || null,
      price_override || null,
      id,
    ]
  );
  res.json({ ok: true });
});

/* ===============================
   Blackout
   =============================== */
app.get("/api/admin/no-service-days", async (_req, res) => {
  const rows = await all("SELECT * FROM blackout ORDER BY date, slot");
  res.json(rows);
});

app.post("/api/admin/no-service-days", async (req, res) => {
  const { date, slot } = req.body || {};
  await run("INSERT INTO blackout(date, slot) VALUES(?,?)", [date, slot]);
  res.json({ ok: true });
});

app.delete("/api/admin/no-service-days/:id", async (req, res) => {
  const { id } = req.params;
  await run("DELETE FROM blackout WHERE id=?", [id]);
  res.json({ ok: true });
});

/* ===============================
   Active Policy (Student Page)
   =============================== */
app.get("/api/policy/active", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).json({ error: "code required" });

  const s = await get("SELECT * FROM students WHERE code=?", [code]);
  if (!s) return res.status(404).json({ error: "not found" });

  const g = await get("SELECT * FROM policy WHERE id=1");

  const rawAllowed =
    (s.allowed_weekdays && s.allowed_weekdays.trim()) ||
    (g.allowed_weekdays || "");
  const allowed = new Set(
    rawAllowed
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );

  const toDate = (v) => (v ? new Date(v) : null);
  const gStart = toDate(g.start_date);
  const gEnd = toDate(g.end_date);
  const sStart = toDate(s.start_date);
  const sEnd = toDate(s.end_date);

  const effStart = [gStart, sStart]
    .filter(Boolean)
    .reduce((a, b) => (a && b ? (a > b ? a : b) : a || b), null);
  const effEnd = [gEnd, sEnd]
    .filter(Boolean)
    .reduce((a, b) => (a && b ? (a < b ? a : b) : a || b), null);

  const start_date = effStart
    ? dayjs(effStart).format("YYYY-MM-DD")
    : g.start_date || s.start_date || null;
  const end_date = effEnd
    ? dayjs(effEnd).format("YYYY-MM-DD")
    : g.end_date || s.end_date || null;

  const bl = await all("SELECT * FROM blackout");
  res.json({
    base_price: s.price_override ?? g.base_price,
    allowed_weekdays: Array.from(allowed),
    start_date,
    end_date,
    no_service_days: bl,
    student: { id: s.id, name: s.name, code: s.code },
    sms_extra_text: g?.sms_extra_text ?? null,
  });
});

/* ===============================
   Orders / Payments
   =============================== */
app.post("/api/orders/commit", async (req, res) => {
  const { code, items } = req.body || {};
  const s = await get("SELECT * FROM students WHERE code=?", [code]);
  if (!s) return res.status(404).json({ error: "student not found" });

  const now = dayjs().toISOString();
  for (const it of items || []) {
    await run(
      "INSERT INTO orders(student_id,date,slot,price,status,created_at) VALUES(?,?,?,?,?,?)",
      [s.id, it.date, it.slot, it.price, "SELECTED", now]
    );
  }
  res.json({ ok: true });
});

app.post("/api/payments/toss/confirm", async (req, res) => {
  const { paymentKey, orderId, amount, code, dateslots } = req.body || {};
  if (!paymentKey || !amount || !orderId)
    return res.status(400).json({ error: "missing fields" });
  try {
    const secretKey = process.env.TOSS_SECRET_KEY || "";
    const resp = await axios.post(
      "https://api.tosspayments.com/v1/payments/confirm",
      { paymentKey, orderId, amount },
      {
        headers: {
          Authorization:
            "Basic " + Buffer.from(secretKey + ":").toString("base64"),
        },
      }
    );

    const s = await get("SELECT * FROM students WHERE code=?", [code]);
    if (s && Array.isArray(dateslots)) {
      for (const it of dateslots) {
        await run(
          'UPDATE orders SET status="PAID" WHERE student_id=? AND date=? AND slot=?',
          [s.id, it.date, it.slot]
        );
      }
    }
    res.json({ ok: true, receipt: resp.data });
  } catch (e) {
    res.status(400).json({
      error: "confirm_failed",
      detail: e?.response?.data || String(e),
    });
  }
});

/* ===============================
   Admin: Orders List & Cancellation
   =============================== */

// 신청 리스트 조회
app.get("/api/admin/orders", async (req, res) => {
  try {
    const { start, end, q } = req.query || {};

    const where = ["o.status IN ('SELECTED','PAID')"];
    const params = [];
    if (start) { where.push("o.date >= ?"); params.push(start); }
    if (end)   { where.push("o.date <= ?"); params.push(end); }
    if (q && String(q).trim()) {
      where.push("(s.name LIKE ? OR s.code LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }

    const sql = `
      SELECT 
        o.id, o.date, o.slot, o.price, o.status,
        s.id AS student_id, s.name, s.code
      FROM orders o
      JOIN students s ON s.id = o.student_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY s.name ASC, o.date ASC, o.slot ASC
    `;
    const rows = await all(sql, params);

    // 학생별 그룹 합계도 제공
    const byStudent = new Map();
    for (const r of rows) {
      const key = r.student_id;
      if (!byStudent.has(key)) {
        byStudent.set(key, {
          student_id: r.student_id,
          name: r.name,
          code: r.code,
          total_amount: 0,
          count: 0,
          items: [],
        });
      }
      const g = byStudent.get(key);
      g.items.push({
        id: r.id,
        date: r.date,
        slot: r.slot,
        price: r.price,
        status: r.status,
      });
      g.count += 1;
      g.total_amount += Number(r.price || 0);
    }

    res.json({ ok: true, rows, groups: Array.from(byStudent.values()) });
  } catch (e) {
    console.error("GET /api/admin/orders error:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 개별 끼 취소(삭제)
app.delete("/api/admin/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const r = await run("DELETE FROM orders WHERE id=?", [id]);
    res.json({ ok: true, deleted: Number(r?.changes || 0) });
  } catch (e) {
    console.error("DELETE /api/admin/orders/:id error:", e);
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// 학생 단위 일괄 취소
app.post("/api/admin/orders/cancel-student", async (req, res) => {
  try {
    const { code, start, end, slot } = req.body || {};
    if (!code) return res.status(400).json({ ok: false, error: "code required" });

    const s = await get("SELECT id FROM students WHERE code=?", [code]);
    if (!s) return res.status(404).json({ ok: false, error: "student not found" });

    const where = ["student_id = ?"];
    const params = [s.id];
    if (start) { where.push("date >= ?"); params.push(start); }
    if (end)   { where.push("date <= ?"); params.push(end); }
    if (slot && (slot === "LUNCH" || slot === "DINNER")) {
      where.push("slot = ?"); params.push(slot);
    }

    const sql = `DELETE FROM orders WHERE ${where.join(" AND ")}`;
    const r = await run(sql, params);
    res.json({ ok: true, deleted: Number(r?.changes || 0) });
  } catch (e) {
    console.error("POST /api/admin/orders/cancel-student error:", e);
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

/* ===============================
   Weekly Summary
   =============================== */
app.get("/api/admin/weekly-summary", async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end)
    return res.status(400).json({ error: "start and end required" });

  const days = [];
  let cur = dayjs(start);
  const endD = dayjs(end);
  while (cur.isBefore(endD) || cur.isSame(endD)) {
    days.push(cur.format("YYYY-MM-DD"));
    cur = cur.add(1, "day");
  }

  const students = await all(
    "SELECT id, name, code FROM students ORDER BY name"
  );
  // 결제된 건(=PAID)만 요약에 포함
  const orders = await all(
    "SELECT student_id, date, slot FROM orders WHERE status='PAID' AND date BETWEEN ? AND ?",
    [start, end]
  );

  const hasMap = new Map();
  orders.forEach((o) => {
    hasMap.set(`${o.student_id}|${o.date}|${o.slot}`, true);
  });

  const rows = students.map((s) => {
    const byDate = {};
    let count = 0;
    days.forEach((d) => {
      const lunch = !!hasMap.get(`${s.id}|${d}|LUNCH`);
      const dinner = !!hasMap.get(`${s.id}|${d}|DINNER`);
      if (lunch) count++;
      if (dinner) count++;
      byDate[d] = { LUNCH: lunch, DINNER: dinner };
    });
    return { id: s.id, name: s.name, code: s.code, count, byDate };
  });

  const applied = rows
    .filter((r) => r.count > 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      count: r.count,
      items: days.flatMap((d) =>
        [
          r.byDate[d].LUNCH ? { date: d, slot: "LUNCH" } : null,
          r.byDate[d].DINNER ? { date: d, slot: "DINNER" } : null,
        ].filter(Boolean)
      ),
    }));
  const notApplied = rows
    .filter((r) => r.count === 0)
    .map(({ id, name, code }) => ({ id, name, code }));

  res.json({ start, end, days, rows, applied, notApplied });
});

/* ===============================
   Attendance CSV
   =============================== */
app.get("/api/admin/attendance.csv", async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "date required" });

  const lunch = (
    await all(
      `SELECT students.name
       FROM orders JOIN students ON orders.student_id=students.id
       WHERE orders.date=? AND orders.slot='LUNCH' AND orders.status='PAID'
       ORDER BY students.name`,
      [date]
    )
  ).map((r) => r.name);

  const dinner = (
    await all(
      `SELECT students.name
       FROM orders JOIN students ON orders.student_id=students.id
       WHERE orders.date=? AND orders.slot='DINNER' AND orders.status='PAID'
       ORDER BY students.name`,
      [date]
    )
  ).map((r) => r.name);

  const header = "slot,name\n";
  const body =
    lunch.map((n) => `LUNCH,"${n.replaceAll(`"`, `""`)}"`).join("\n") +
    (lunch.length && dinner.length ? "\n" : "") +
    dinner.map((n) => `DINNER,"${n.replaceAll(`"`, `""`)}"`).join("\n");
  const csv = header + body + "\n";

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="attendance_${date}.csv"`
  );
  res.send(csv);
});

/* ===============================
   인쇄용 JSON API (단일 날짜, 중복 제거)
   =============================== */
app.get("/api/admin/print", async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ ok: false, error: "date required" });

  // 학생 1명당 1행: PAID 여부는 MAX 집계로 판단
  const lunchRows = await all(
    `
    SELECT s.id, s.name, s.code,
           MAX(CASE WHEN o.status='PAID' THEN 1 ELSE 0 END) AS is_paid
      FROM orders o
      JOIN students s ON o.student_id = s.id
     WHERE o.date=? AND o.slot='LUNCH' AND o.status IN ('SELECTED','PAID')
  GROUP BY s.id, s.name, s.code
  ORDER BY is_paid DESC, s.name ASC
    `,
    [date]
  );

  const dinnerRows = await all(
    `
    SELECT s.id, s.name, s.code,
           MAX(CASE WHEN o.status='PAID' THEN 1 ELSE 0 END) AS is_paid
      FROM orders o
      JOIN students s ON o.student_id = s.id
     WHERE o.date=? AND o.slot='DINNER' AND o.status IN ('SELECTED','PAID')
  GROUP BY s.id, s.name, s.code
  ORDER BY is_paid DESC, s.name ASC
    `,
    [date]
  );

  const lunch = lunchRows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    status: Number(r.is_paid) ? "PAID" : "SELECTED",
  }));
  const dinner = dinnerRows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    status: Number(r.is_paid) ? "PAID" : "SELECTED",
  }));

  return res.json({
    ok: true,
    date,
    lunch,
    dinner,
    counts: {
      lunch_total: lunch.length,
      dinner_total: dinner.length,
      lunch_paid: lunch.filter((x) => x.status === "PAID").length,
      dinner_paid: dinner.filter((x) => x.status === "PAID").length,
    },
  });
});

/* ===============================
   신청자(기간) 조회 / 저장 — 학생 단일 체크(점/저 묶음)
   =============================== */

// 기간 내 신청자 목록(학생 단위 집계)
app.get("/api/admin/applicants-range", async (req, res) => {
  try {
    const { start, end } = req.query || {};
    if (!start || !end) {
      return res
        .status(400)
        .json({ ok: false, error: "start and end required" });
    }

    const rows = await all(
      `
      SELECT
        s.id,
        s.name,
        s.code,
        SUM(CASE WHEN o.status IN ('SELECTED','PAID') THEN 1 ELSE 0 END) AS applied_count,
        SUM(CASE WHEN o.status='PAID' THEN 1 ELSE 0 END)               AS paid_count,
        SUM(CASE WHEN o.status IN ('SELECTED','PAID') THEN o.price ELSE 0 END) AS total_amount
      FROM orders o
      JOIN students s ON s.id = o.student_id
      WHERE o.date BETWEEN ? AND ?
      GROUP BY s.id, s.name, s.code
      ORDER BY s.name ASC
      `,
      [start, end]
    );

    const list = rows.map((r) => {
      const applied_count = Number(r.applied_count || 0);
      const paid_count = Number(r.paid_count || 0);
      const total_amount = Number(r.total_amount || 0);
      return {
        id: r.id,
        name: r.name,
        code: r.code,
        applied_count,
        paid_count,
        total_amount,
        paid: applied_count > 0 && paid_count === applied_count,
      };
    });

    return res.json(list);
  } catch (e) {
    console.error("applicants-range error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 기간 내 결제표시 저장 (학생 단위 또는 슬롯 단위)
app.post("/api/admin/payments/mark-range", async (req, res) => {
  try {
    const { start, end, items } = req.body || {};
    if (!start || !end) {
      return res
        .status(400)
        .json({ ok: false, error: "start and end required" });
    }
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return res.json({ ok: true, updated: 0 });

    let updated = 0;

    for (const it of list) {
      const code = String(it.code || "").trim();
      const slotRaw = String(it.slot || "").toUpperCase();
      const hasSlot = slotRaw === "LUNCH" || slotRaw === "DINNER";
      const paid = !!it.paid;
      if (!code) continue;

      const s = await get("SELECT id FROM students WHERE code=?", [code]);
      if (!s) continue;

      const newStatus = paid ? "PAID" : "SELECTED";

      let r;
      if (hasSlot) {
        r = await run(
          `UPDATE orders
             SET status=?
           WHERE student_id=? AND slot=? AND date BETWEEN ? AND ?
             AND status IN ('SELECTED','PAID')`,
          [newStatus, s.id, slotRaw, start, end]
        );
      } else {
        r = await run(
          `UPDATE orders
             SET status=?
           WHERE student_id=? AND date BETWEEN ? AND ?
             AND status IN ('SELECTED','PAID')`,
          [newStatus, s.id, start, end]
        );
      }
      updated += Number(r?.changes || 0);
    }

    return res.json({ ok: true, updated });
  } catch (e) {
    console.error("payments/mark-range error:", e);
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

/* ===============================
   신청자(단일 날짜) 조회 / 저장 - (하위호환)
   =============================== */

// 단일 날짜 신청자 목록
app.get("/api/admin/applicants", async (req, res) => {
  try {
    const { date } = req.query || {};
    if (!date) return res.status(400).json({ ok: false, error: "date required" });

    const rows = await all(
      `
      SELECT
        s.id, s.name, s.code,
        SUM(CASE WHEN o.slot='LUNCH'  THEN 1 ELSE 0 END) AS lunch_applied,
        SUM(CASE WHEN o.slot='DINNER' THEN 1 ELSE 0 END) AS dinner_applied,
        SUM(CASE WHEN o.slot='LUNCH'  AND o.status='PAID' THEN 1 ELSE 0 END) AS lunch_paid_cnt,
        SUM(CASE WHEN o.slot='DINNER' AND o.status='PAID' THEN 1 ELSE 0 END) AS dinner_paid_cnt
      FROM orders o
      JOIN students s ON s.id=o.student_id
     WHERE o.date=? AND o.status IN ('SELECTED','PAID')
  GROUP BY s.id, s.name, s.code
  ORDER BY s.name ASC
      `,
      [date]
    );

    const list = rows.map((r) => {
      const lunchApplied = Number(r.lunch_applied || 0) > 0;
      const dinnerApplied = Number(r.dinner_applied || 0) > 0;
      const lunchPaid =
        lunchApplied &&
        Number(r.lunch_paid_cnt || 0) === Number(r.lunch_applied || 0);
      const dinnerPaid =
        dinnerApplied &&
        Number(r.dinner_paid_cnt || 0) === Number(r.dinner_applied || 0);
      return {
        id: r.id,
        name: r.name,
        code: r.code,
        lunch: { applied: lunchApplied, paid: lunchPaid },
        dinner: { applied: dinnerApplied, paid: dinnerPaid },
      };
    });

    return res.json(list);
  } catch (e) {
    console.error("applicants(date) error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// 단일 날짜 결제 체크 저장 (하위호환)
app.post("/api/admin/payments/mark", async (req, res) => {
  try {
    const { date, items } = req.body || {};
    if (!date) return res.status(400).json({ ok: false, error: "date required" });
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return res.json({ ok: true, updated: 0 });

    let updated = 0;

    for (const it of list) {
      const code = String(it.code || "").trim();
      const slot = String(it.slot || "").toUpperCase();
      const paid = !!it.paid;
      if (!code || (slot !== "LUNCH" && slot !== "DINNER")) continue;

      const s = await get("SELECT id FROM students WHERE code=?", [code]);
      if (!s) continue;

      const newStatus = paid ? "PAID" : "SELECTED";
      const r = await run(
        `UPDATE orders
            SET status=?
          WHERE student_id=? AND slot=? AND date=? AND status IN ('SELECTED','PAID')`,
        [newStatus, s.id, slot, date]
      );
      updated += Number(r?.changes || 0);
    }

    return res.json({ ok: true, updated });
  } catch (e) {
    console.error("payments/mark (single) error:", e);
    return res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

/* ===============================
   Menu Images
   =============================== */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) =>
    cb(null, uuidv4() + path.extname(file.originalname)),
});
const upload = multer({ storage });

app.post("/api/admin/menu-images", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "파일이 없습니다." });
  const url = `/uploads/${path.basename(req.file.path)}`;
  const now = dayjs().toISOString();
  await run("INSERT INTO menu_images(url, uploaded_at) VALUES(?,?)", [url, now]);
  const row = await get(
    "SELECT * FROM menu_images WHERE url=? ORDER BY id DESC LIMIT 1",
    [url]
  );
  res.json(row || { url });
});

app.get("/api/menu-images", async (_req, res) => {
  const rows = await all(
    "SELECT * FROM menu_images ORDER BY uploaded_at DESC LIMIT 5"
  );
  res.json(rows);
});

app.get("/api/admin/menu-images", async (_req, res) => {
  const rows = await all("SELECT * FROM menu_images ORDER BY uploaded_at DESC");
  res.json(rows);
});

app.delete("/api/admin/menu-images/:id", async (req, res) => {
  const row = await get("SELECT * FROM menu_images WHERE id=?", [req.params.id]);
  if (row) {
    const filepath = path.join(UPLOAD_DIR, path.basename(row.url));
    try {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    } catch {}
    await run("DELETE FROM menu_images WHERE id=?", [req.params.id]);
  }
  res.json({ ok: true });
});

/* ===============================
   SMS
   =============================== */
function createSolapiAuthHeader(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

app.post("/api/sms/summary", async (req, res) => {
  try {
    const { to, code, items, total, name } = req.body || {};
    if (!to || !code || !Array.isArray(items)) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
    }

    const s = await get("SELECT * FROM students WHERE code=?", [code]);
    if (!s)
      return res.status(404).json({ ok: false, error: "student not found" });

    const g = await get("SELECT sms_extra_text FROM policy WHERE id=1");
    const policyExtra = (g?.sms_extra_text ?? "").toString().trim();

    const dest = onlyDigits(to);
    const sender = onlyDigits(process.env.COOLSMS_SENDER || "");
    if (!sender)
      return res.status(400).json({ ok: false, error: "MISSING_SENDER" });
    if (dest.length < 9)
      return res
        .status(400)
        .json({ ok: false, error: "INVALID_TO_NUMBER" });

    // 집계(중복 제거)
    const uniq = new Map();
    for (const it of items || []) {
      if (!it?.date) continue;
      const slot = String(it.slot || "").toUpperCase();
      if (slot !== "LUNCH" && slot !== "DINNER") continue;
      uniq.set(`${it.date}|${slot}`, { date: it.date, slot });
    }
    const uniqItems = Array.from(uniq.values());
    const totalCount = uniqItems.length;

    const clientTotal = Number.isFinite(Number(total)) ? Number(total) : null;
    const computedTotal = items.reduce(
      (sum, it) => sum + (Number(it.price) || 0),
      0
    );
    const totalAmount = clientTotal ?? computedTotal ?? 0;

    const byDate = new Map();
    for (const { date, slot } of uniqItems) {
      if (!byDate.has(date)) byDate.set(date, new Set());
      byDate.get(date).add(slot);
    }
    const orderedDates = Array.from(byDate.keys()).sort();

    const fmtMD = (dstr) => {
      const d = dayjs(dstr);
      if (!d.isValid()) return dstr;
      return `${d.month() + 1}/${d.date()}`;
    };
    let periodText = "-";
    if (orderedDates.length >= 1) {
      const from = orderedDates[0];
      const toDate = orderedDates[orderedDates.length - 1];
      periodText = fmtMD(from) + (from === toDate ? "" : `~${fmtMD(toDate)}`);
    }

    const koWeek = ["일", "월", "화", "수", "목", "금", "토"];
    const lines = orderedDates
      .map((d) => {
        const wd = koWeek[dayjs(d).day()];
        const set = byDate.get(d) || new Set();
        const parts = [];
        if (set.has("LUNCH")) parts.push("점심");
        if (set.has("DINNER")) parts.push("저녁");
        return `${fmtMD(d)}(${wd}) ${parts.join(", ")}`;
      })
      .join("\n");

    const studentName = (name || s.name || "").trim();
    let text =
      `[메디컬로드맵 도시락 신청]\n\n` +
      `※ ${studentName}학생\n` +
      `- 기간: ${periodText}\n` +
      `- 식수: ${totalCount}식\n` +
      `- 비용: ${Number(totalAmount || 0).toLocaleString()}원\n`;

    if (policyExtra) {
      const clipped = policyExtra.slice(0, 700);
      text += `\n\n※ 입금 계좌\n${clipped}\n`;
    }

    text += `\n\n※ 신청내역\n${lines || "-"}`;

    const apiKey = process.env.COOLSMS_API_KEY;
    const apiSecret = process.env.COOLSMS_API_SECRET;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ ok: false, error: "MISSING_API_KEYS" });
    }

    const authHeader = createSolapiAuthHeader(apiKey, apiSecret);
    const payload = { message: { to: dest, from: sender, text } };

    const resp = await axios.post(
      "https://api.solapi.com/messages/v4/send",
      payload,
      {
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
      }
    );

    return res.json({ ok: true, result: resp.data });
  } catch (e) {
    const detail = e?.response?.data || String(e);
    console.error("SMS_SEND_ERROR:", detail);
    return res.status(400).json({ ok: false, error: detail });
  }
});

/* ===============================
   Static / SPA
   =============================== */
const PUBLIC_DIR = path.join(__dirname, "public");
console.log("[STATIC] PUBLIC_DIR =", PUBLIC_DIR);
console.log("[STATIC] exists(public)     =", fs.existsSync(PUBLIC_DIR));
console.log(
  "[STATIC] exists(index.html) =",
  fs.existsSync(path.join(PUBLIC_DIR, "index.html"))
);

app.use(express.static(PUBLIC_DIR));

const SPA_ROUTES = [
  "/",
  "/admin",
  "/admin/orders",
  "/admin/print",
  "/payment/success",
  "/payment/fail",
];
SPA_ROUTES.forEach((routePath) => {
  app.get(routePath, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
});

app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

console.log("ENV.PORT =", process.env.PORT);
console.log("Starting server, PORT =", PORT);
console.log("Serving static from:", PUBLIC_DIR);
app.listen(PORT, "0.0.0.0", () => console.log("Server started on port", PORT));
