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
  // 스케줄 조회 (관리자)
  // =========================
  router.get("/schedules", verifyToken, async (_req, res) => {
    try {
      const schedules = await db.all(`
        SELECT
          sch.student_id AS student_id,  -- ✅ 프론트가 기대하는 필드명
          s.name         AS name,
          sch.day        AS day,
          sch.start      AS start,
          sch.end        AS end,
          sch.type       AS type,
          sch.description AS description
        FROM schedules sch
        LEFT JOIN students s ON s.id = sch.student_id
        ORDER BY sch.student_id, sch.day, sch.start
      `);
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
  // 관리자 설정 저장 (새 레코드 추가) — 메서드 표준화: PUT
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

      // 방금 저장된 최신 레코드 반환
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
  // 학생 등록 (id 없으면 자동 생성)
  //  - DB 스키마: students.id TEXT PRIMARY KEY
  //  - 숫자 문자열 ID를 사용하는 기존 데이터와의 호환을 위해 CAST 기반 증가 생성
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
  // 🔥 (추가) 학생 수정
  // 프런트 StudentDetailModal에서 axios.put(`/admin/students/:id`) 호출
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
        [
          name ?? "",
          grade ?? "",
          studentPhone ?? "",
          parentPhone ?? "",
          id,
        ]
      );

      const updated = await db.get("SELECT * FROM students WHERE id = ?", [id]);
      return res.json({ success: true, message: "학생 정보가 수정되었습니다.", student: updated });
    } catch (err) {
      console.error("❌ 학생 수정 오류:", err.message);
      res.status(500).json({ error: "학생 수정 실패", details: err.message });
    }
  });

  // =========================
  // 관리자 로그인 (토큰 발급) — verifyToken 불필요
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

      let token;
      try {
        token = jwt.sign(
          { id: admin.id, username: admin.username, role: admin.role || "admin" },
          ensureJwtSecret(),
          { expiresIn: "1d" }
        );
      } catch (e) {
        console.error("❌ JWT 발급 오류:", e.message);
        return res.status(500).json({ error: "서버 설정 오류: JWT 발급 실패" });
      }

      res.json({ success: true, token });
    } catch (err) {
      console.error("❌ 로그인 오류:", err.message);
      res.status(500).json({ error: "로그인 실패" });
    }
  });

  // -------------------------
  // 🔒 로그인 이후 보호 라우트 일괄 적용(기존 verifyToken 데코레이터도 그대로 유지)
  // -------------------------
  router.use(verifyToken);

  // =========================
  // 🔥 (추가) 인증 상태 확인용 /auth-check
  // =========================
  router.get("/auth-check", (req, res) => {
    // verifyToken을 통과했다면 토큰이 유효
    res.json({ ok: true, admin: req.admin || null });
  });

  // =========================
  // 🔥 (추가) 내 정보
  // =========================
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
  // 학생별 스케줄 상세 조회
  // =========================
  
  router.get("/student-schedules", verifyToken, async (_req, res) => {
    try {
      // ✅ 수정본: 프런트가 기대하는 student_id 를 명시적으로 포함
      const schedules = await db.all(`
        SELECT
          sch.student_id AS student_id,    -- ← 프런트에서 필요
          s.name                            AS name,
          sch.day                           AS day,
          sch.start                         AS start,
          sch.end                           AS end,
          sch.type                          AS type,
          sch.description                   AS description
        FROM schedules sch
        LEFT JOIN students s ON s.id = sch.student_id
        ORDER BY sch.student_id, sch.day, sch.start
      `);

      res.json(schedules || []);
    } catch (error) {
      console.error("❌ 학생 스케줄 상세 조회 오류:", error.message);
      res.status(500).json({ error: "학생 스케줄 불러오기 실패" });
    }
  });
   router.get("/studentschedules", verifyToken, async (_req, res) => {
     try {
        const students = await db.all("SELECT * FROM students");
        const schedules = await db.all("SELECT * FROM schedules");
        res.json({ students, schedules });
      } catch (err) {
        console.error("❌ 학생 + 일정 불러오기 실패:", err.message);
        res.status(500).json({ error: "학생 + 일정 불러오기 실패" });
      }
    });

  return router;
}
