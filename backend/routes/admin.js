import express from "express";
import pkg from "../services/smsService.js";
import bcrypt from "bcrypt";              // ✅ 비밀번호 해시 비교
import jwt from "jsonwebtoken";           // ✅ JWT 토큰
import dotenv from "dotenv";              // ✅ 환경변수
import { verifyToken } from "../middleware/auth.js"; // ✅ 인증 미들웨어 경로 수정
dotenv.config();

const { sendSMS } = pkg;

export default function adminRoutes(db) {
  const router = express.Router();

  // =========================
  // 유틸: JWT 비밀키 확인
  // =========================
  const ensureJwtSecret = () => {
    const secret = process.env.JWT_SECRET;
    if (!secret || !String(secret).trim()) {
      throw new Error("JWT_SECRET 환경변수가 설정되지 않았습니다.");
    }
    return secret;
  };

  // =========================
  // 🧭 이번 주 월요일 구하기 (YYYY-MM-DD)
  // =========================
  const getWeekStartMondayStr = (base = new Date()) => {
    const d = new Date(base);
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  };

  // =========================
  // 스케줄 조회 (관리자)
  // =========================
  router.get("/schedules", verifyToken, async (req, res) => {
    try {
      const { weekStart } = req.query;
      let week_start = weekStart ? String(weekStart).slice(0, 10) : null;
      let schedules = [];

      if (week_start) {
        schedules = await db.all(
          `
          SELECT sch.student_id, s.name, sch.day, sch.start, sch.end,
                sch.type, sch.description, sch.week_start, sch.saved_at
          FROM schedules sch
          LEFT JOIN students s ON s.id = sch.student_id
          WHERE sch.week_start = ?
          ORDER BY sch.student_id, sch.day, sch.start
          `,
          [week_start]
        );

        // ✅ 새 주차 데이터가 없으면 이전 주차 데이터 복사
        if (!schedules || schedules.length === 0) {
          const lastWeek = await db.get(`
            SELECT week_start
            FROM schedules
            GROUP BY week_start
            ORDER BY MAX(saved_at) DESC
            LIMIT 1
          `);

          if (lastWeek?.week_start && lastWeek.week_start !== week_start) {
            console.log(`⚙️ 새 주차(${week_start}) 데이터 없음 → ${lastWeek.week_start} 기준으로 복사 시작`);

            const lastWeekRows = await db.all(
              `SELECT * FROM schedules WHERE week_start = ?`,
              [lastWeek.week_start]
            );

            for (const row of lastWeekRows) {
              await db.run(
                `
                INSERT INTO schedules (student_id, student_code, day, start, end, type, description, week_start, saved_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                `,
                [
                  row.student_id,
                  row.student_code || "",
                  row.day,
                  row.start,
                  row.end,
                  row.type,
                  row.description,
                  week_start,
                ]
              );
            }

            console.log(`🆕 ${lastWeek.week_start} → ${week_start} 일정 자동 복사 완료`);

            schedules = await db.all(
              `
              SELECT sch.student_id, s.name, sch.day, sch.start, sch.end,
                    sch.type, sch.description, sch.week_start, sch.saved_at
              FROM schedules sch
              LEFT JOIN students s ON s.id = sch.student_id
              WHERE sch.week_start = ?
              ORDER BY sch.student_id, sch.day, sch.start
              `,
              [week_start]
            );
          }
        }
      }

      res.json(schedules || []);
    } catch (error) {
      console.error("❌ 스케줄 조회 오류:", error.message);
      res.status(500).json({ error: "스케줄 조회 실패" });
    }
  });

  // =========================
  // 관리자: 개별/일괄 SMS 발송
  // =========================
  router.post("/send-sms", verifyToken, async (req, res) => {
    try {
      const { phoneNumbers, message } = req.body;

      if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
        return res.status(400).json({ error: "전화번호 배열 필요" });
      }
      if (!message || message.trim() === "") {
        return res.status(400).json({ error: "메시지 입력 필요" });
      }

      const results = [];
      for (const phone of phoneNumbers) {
        const result = await sendSMS(phone, message);
        results.push({ phone, status: "success", response: result });
      }

      res.json({ success: true, sent: results });
    } catch (error) {
      console.error("❌ 문자 발송 오류:", error.message);
      res.status(500).json({ error: "SMS 발송 중 오류 발생" });
    }
  });

  // =========================
  // 관리자 설정 조회 (최신 1건)
  // =========================
  router.get("/settings", verifyToken, async (_req, res) => {
    try {
      const row = await db.get(`
        SELECT
          id,
          week_range_text,
          external_desc,
          external_example,
          center_desc,
          center_example,
          notification_footer
        FROM settings
        ORDER BY id DESC
        LIMIT 1
      `);
      res.json(row || {});
    } catch (err) {
      console.error("❌ 설정 불러오기 오류:", err.message);
      res.status(500).json({ error: "설정 조회 실패" });
    }
  });

  // =========================
  // 관리자 설정 저장 (새 레코드 추가)
  // =========================
  router.put("/settings", verifyToken, async (req, res) => {
    try {
      const {
        week_range_text,
        external_desc,
        external_example,
        center_desc,
        center_example,
        notification_footer,
      } = req.body || {};

      await db.run(
        `INSERT INTO settings (
          week_range_text, external_desc, external_example,
          center_desc, center_example, notification_footer
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          week_range_text ?? "",
          external_desc ?? "",
          external_example ?? "",
          center_desc ?? "",
          center_example ?? "",
          notification_footer ?? "",
        ]
      );

      const latest = await db.get(
        `SELECT * FROM settings ORDER BY id DESC LIMIT 1`
      );

      return res.json({
        success: true,
        settings: latest || {},
      });
    } catch (err) {
      console.error("❌ 설정 저장 오류:", err.message);
      res.status(500).json({ error: "설정 저장 실패", details: err.message });
    }
  });

  // =========================
  // 학생 목록 조회
  // =========================
  router.get("/students", verifyToken, async (_req, res) => {
    try {
      const rows = await db.all("SELECT * FROM students");
      res.json(rows || []);
    } catch (err) {
      console.error("❌ 학생 목록 조회 오류:", err.message);
      res.status(500).json({ error: "학생 목록 불러오기 실패" });
    }
  });

  // =========================
  // 학생 등록
  // =========================
  router.post("/students", verifyToken, async (req, res) => {
    try {
      let { id, name, grade, studentPhone, parentPhone } = req.body || {};

      if (!name || String(name).trim() === "") {
        return res.status(400).json({ error: "이름은 필수입니다." });
      }

      if (!id) {
        const max = await db.get(
          "SELECT MAX(CAST(id AS INTEGER)) AS maxId FROM students"
        );
        id = String((max?.maxId || 0) + 1);
      } else {
        const existing = await db.get("SELECT id FROM students WHERE id = ?", [id]);
        if (existing) {
          return res.status(409).json({ error: "이미 존재하는 ID입니다." });
        }
      }

      await db.run(
        `INSERT INTO students (id, name, grade, studentPhone, parentPhone)
         VALUES (?, ?, ?, ?, ?)`,
        [id, name, grade || "", studentPhone || "", parentPhone || ""]
      );

      res.json({ success: true, message: "학생 등록 완료", studentId: id });
    } catch (err) {
      console.error("❌ 학생 등록 오류:", err.message);
      res.status(500).json({ error: "학생 등록 실패", details: err.message });
    }
  });

  // =========================
  // 학생 삭제
  // =========================
  router.delete("/students/:id", verifyToken, async (req, res) => {
    try {
      const studentId = req.params.id;

      await db.run("DELETE FROM students WHERE id = ?", [studentId]);
      await db.run("DELETE FROM schedules WHERE student_id = ?", [studentId]);

      res.json({ success: true, message: "학생 삭제 완료" });
    } catch (err) {
      console.error("❌ 학생 삭제 오류:", err.message);
      res.status(500).json({ error: "학생 삭제 실패" });
    }
  });

  // =========================
  // 학생 수정
  // =========================
  router.put("/students/:id", verifyToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, grade, studentPhone, parentPhone } = req.body || {};

      const existing = await db.get("SELECT id FROM students WHERE id = ?", [id]);
      if (!existing) {
        return res.status(404).json({ error: "해당 학생이 존재하지 않습니다." });
      }

      await db.run(
        `UPDATE students
           SET name = ?, grade = ?, studentPhone = ?, parentPhone = ?
         WHERE id = ?`,
        [name ?? "", grade ?? "", studentPhone ?? "", parentPhone ?? "", id]
      );

      const updated = await db.get("SELECT * FROM students WHERE id = ?", [id]);
      return res.json({ success: true, message: "학생 정보 수정 완료", student: updated });
    } catch (err) {
      console.error("❌ 학생 수정 오류:", err.message);
      res.status(500).json({ error: "학생 수정 실패", details: err.message });
    }
  });

  // =========================
  // 관리자 로그인
  // =========================
  router.post("/login", async (req, res) => {
    const { username, password } = req.body || {};

    try {
      const admin = await db.get(
        `SELECT id, username, password, role FROM admins WHERE username = ?`,
        [username]
      );
      if (!admin) {
        return res.status(404).json({ error: "존재하지 않는 계정입니다." });
      }

      const match = await bcrypt.compare(password || "", admin.password);
      if (!match) {
        return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
      }

      const token = jwt.sign(
        { id: admin.id, username: admin.username, role: admin.role || "admin" },
        ensureJwtSecret(),
        { expiresIn: "1d" }
      );

      res.json({ success: true, token });
    } catch (err) {
      console.error("❌ 로그인 오류:", err.message);
      res.status(500).json({ error: "로그인 실패" });
    }
  });

  // -------------------------
  // 🔒 로그인 이후 보호 라우트
  // -------------------------
  router.use(verifyToken);

  router.get("/auth-check", (req, res) => {
    res.json({ ok: true, admin: req.admin || null });
  });

  router.get("/me", async (req, res) => {
    try {
      const me = await db.get(
        "SELECT id, username, role FROM admins WHERE id = ?",
        [req.admin?.id]
      );
      res.json(me || {});
    } catch (err) {
      console.error("❌ /me 오류:", err.message);
      res.status(500).json({ error: "내 정보 조회 실패" });
    }
  });

  // =========================
  // ✅ (핵심 수정) 학생 + 일정 조회 (이번 주만)
  // =========================
  router.get("/studentschedules", verifyToken, async (req, res) => {
    try {
      const { weekStart } = req.query;
      const week_start =
        typeof weekStart === "string" && weekStart.length >= 8
          ? weekStart.slice(0, 10)
          : getWeekStartMondayStr(new Date());

      const students = await db.all("SELECT * FROM students");
      const schedules = await db.all(
        "SELECT * FROM schedules WHERE week_start = ?",
        [week_start]
      );

      res.json({ students, schedules });
    } catch (err) {
      console.error("❌ 학생 + 일정 불러오기 실패:", err.message);
      res.status(500).json({ error: "학생 + 일정 불러오기 실패" });
    }
  });

  // =========================
  // 전체 일정 삭제 (관리자용 긴급 초기화)
  // =========================
  router.delete("/schedules/clearAll", verifyToken, async (req, res) => {
    try {
      console.log("⚠️ 관리자 전체 일정 삭제 요청 수신됨");

      await db.run("DELETE FROM schedules");
      await db.run("DELETE FROM sqlite_sequence WHERE name='schedules'");

      console.log("🧹 모든 일정 데이터 초기화 완료");
      res.json({ success: true, message: "모든 일정이 삭제되었습니다." });
    } catch (err) {
      console.error("❌ 전체 일정 삭제 오류:", err.message);
      res.status(500).json({ success: false, message: "삭제 중 오류 발생" });
    }
  });
  
  // =========================
  // ✅ 새 주차 일정 복사 (AdminDashboard.jsx 자동 복사용)
  // =========================
  router.post("/copyWeek", verifyToken, async (req, res) => {
    const { fromWeek, toWeek } = req.body;
    if (!fromWeek || !toWeek) {
      return res.status(400).json({ error: "fromWeek, toWeek 필수" });
    }

    try {
      const rows = await db.all("SELECT * FROM schedules WHERE week_start = ?", [fromWeek]);
      if (!rows.length) {
        return res.json({ success: true, message: "복사할 데이터 없음" });
      }

      const existing = await db.get("SELECT COUNT(*) as cnt FROM schedules WHERE week_start = ?", [toWeek]);
      if (existing.cnt > 0) {
        return res.json({ success: true, message: "이미 새 주차 데이터 존재" });
      }

      const stmt = await db.prepare(`
        INSERT INTO schedules (student_id, student_code, day, start, end, type, description, week_start, saved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
      `);
      for (const r of rows) {
        await stmt.run(
          r.student_id,
          r.student_code || "",
          r.day,
          r.start,
          r.end,
          r.type,
          r.description,
          toWeek
        );
      }
      await stmt.finalize();

      console.log(`🆕 ${fromWeek} → ${toWeek} 일정 복사 완료 (${rows.length}개)`);

      res.json({ success: true, copied: rows.length });
    } catch (err) {
      console.error("❌ copyWeek error:", err);
      res.status(500).json({ error: "주차 복사 중 오류" });
    }
  });

  return router;
}
