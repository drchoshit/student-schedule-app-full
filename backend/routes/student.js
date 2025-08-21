import express from "express";
import pkg from "../services/smsService.js";
const { sendSMS } = pkg;

/**
 * 학생 관련 라우트
 * - 로그인
 * - 설정 조회
 * - 스케줄 저장: 주차(week_start) 단위로 교체 저장
 * - 스케줄 조회: 학생/주차별 조회
 * - 최근 저장본 주차 목록: 최신 3개
 */
export default function studentRoutes(db) {
  const router = express.Router();

  /** 유틸: 문자열을 YYYY-MM-DD 로 고정 */
  const toYmd = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  /** 유틸: 특정 날짜 기준 그 주의 월요일(주 시작) YYYY-MM-DD */
  const getWeekStartMondayStr = (base = new Date()) => {
    const d = new Date(base);
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return toYmd(d);
  };

  // ✅ 설정 조회
  router.get("/settings", async (_req, res) => {
    try {
      const row = await db.get(`
        SELECT
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
      console.error("❌ 학생용 설정 조회 오류:", err.message);
      res.status(500).json({ error: "설정 조회 실패" });
    }
  });

  // ✅ 학생 로그인
  router.post("/login", async (req, res) => {
    try {
      const { name, code } = req.body;
      if (!name || !code) {
        return res.status(400).json({ error: "이름과 코드를 모두 입력하세요." });
      }
      const query =
        "SELECT id, name, grade, studentPhone, parentPhone FROM students WHERE id = ? AND name = ?";
      const student = await db.get(query, [code, name]);
      if (!student) {
        return res
          .status(404)
          .json({ error: "학생을 찾을 수 없습니다. 이름과 코드를 다시 확인하세요." });
      }
      const safeStudent = {
        id: student.id,
        name: student.name,
        grade: student.grade || "",
        studentPhone: student.studentPhone || "",
        parentPhone: student.parentPhone || "",
      };
      return res.json({ success: true, student: safeStudent });
    } catch (error) {
      console.error("❌ 학생 로그인 오류:", error);
      return res.status(500).json({ error: `서버 오류: 로그인 실패 (${error.message})` });
    }
  });

  /* =========================
     스케줄 저장/조회 (주차 단위)
     ========================= */

  /**
   * 저장(교체):
   * - Body: { student_id, weekStart?, schedules: [{day,start,end,type,description}] }
   * - weekStart 없으면 현재 주의 월요일로 자동 채움
   * - 기존 로우는 (student_id, week_start) 기준으로만 삭제
   */
  async function saveSchedules(req, res) {
    const tx = db;
    const { student_id, weekStart, schedules } = req.body;

    if (!student_id || !Array.isArray(schedules)) {
      return res.status(400).json({ error: "유효하지 않은 요청입니다." });
    }

    // 주차 결정
    const week_start =
      (typeof weekStart === "string" && weekStart.length >= 8)
        ? weekStart.slice(0, 10) // YYYY-MM-DD 형태로 통일
        : getWeekStartMondayStr(new Date());

    // 간단 검증
    const invalid = schedules.some((s) => !s || !s.day || !s.start || !s.end);
    if (invalid) {
      return res
        .status(400)
        .json({ error: "스케줄 항목에 day/start/end가 모두 필요합니다." });
    }

    try {
      await tx.exec("BEGIN");

      // ✅ 기존: 전체 삭제(문제 원인)
      // await tx.run("DELETE FROM schedules WHERE student_id = ?", [student_id]);
      // ✅ 수정: 해당 주만 삭제
      await tx.run(
        "DELETE FROM schedules WHERE student_id = ? AND week_start = ?",
        [student_id, week_start]
      );

      const stmt = await tx.prepare(
        `INSERT INTO schedules
          (student_id, student_code, day, start, end, type, description, week_start, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const saved_at = new Date().toISOString(); // ISO 타임스탬프

      for (const s of schedules) {
        await stmt.run([
          String(student_id),
          String(student_id),                        // student_code = student_id
          String(s.day).trim(),                      // 요일
          String(s.start).trim(),                    // HH:MM
          String(s.end).trim(),                      // HH:MM
          (s.type ?? "").toString().trim(),
          (s.description ?? "").toString().trim(),
          week_start,                                // ✅ 주차
          saved_at,                                  // ✅ 저장시각
        ]);
      }

      await stmt.finalize();
      await tx.exec("COMMIT");

      // 선택: 관리자 SMS
      try {
        const ADMIN1 = process.env.COOLSMS_ADMIN1 || "";
        const ADMIN2 = process.env.COOLSMS_ADMIN2 || "";
        if (ADMIN1 || ADMIN2) {
          const summary = schedules.map((s) => `${s.day}: ${s.start}-${s.end}`).join(", ");
          const message = `학생 ${student_id} 일정 저장 (${week_start}): ${summary}`;
          if (ADMIN1) await sendSMS(ADMIN1, message);
          if (ADMIN2) await sendSMS(ADMIN2, message);
          return res.json({ success: true, message: "✅ 스케줄 저장 & SMS 발송 완료" });
        }
      } catch (smsError) {
        console.error("⚠️ SMS 발송 오류:", smsError.message);
        return res.json({ success: true, message: "✅ 스케줄 저장 완료 (SMS 발송 실패)" });
      }

      return res.json({ success: true, message: "✅ 스케줄 저장 완료" });
    } catch (error) {
      try { await tx.exec("ROLLBACK"); } catch (_e) {}
      console.error("❌ 스케줄 저장 오류:", error);
      return res.status(500).json({ error: `서버 오류: 스케줄 저장 실패 (${error.message})` });
    }
  }

  // 단수형(기존) + 복수형(프론트 호환) 모두 제공
  router.post("/schedule", saveSchedules);
  router.post("/schedules", saveSchedules);

  /**
   * 조회:
   * - /schedule/:id 또는 /schedules/:id
   * - 쿼리 weekStart=YYYY-MM-DD 가 있으면 해당 주만 반환
   * - 없으면 해당 학생의 **가장 최근 주차**를 반환
   */
  async function fetchSchedules(req, res) {
    try {
      const studentId = req.params.id;
      const weekStart = (req.query.weekStart || "").toString().slice(0, 10);

      if (weekStart) {
        const rows = await db.all(
          `SELECT id, student_id, day, start, end, type, description, week_start, saved_at
             FROM schedules
            WHERE student_id = ? AND week_start = ?
            ORDER BY day, start`,
          [studentId, weekStart]
        );
        return res.json(rows || []);
      }

      // weekStart 미지정 → 가장 최신 주차 구해오기
      const latest = await db.get(
        `SELECT week_start
           FROM schedules
          WHERE student_id = ?
          GROUP BY week_start
          ORDER BY MAX(saved_at) DESC
          LIMIT 1`,
        [studentId]
      );

      if (!latest?.week_start) return res.json([]);

      const rows = await db.all(
        `SELECT id, student_id, day, start, end, type, description, week_start, saved_at
           FROM schedules
          WHERE student_id = ? AND week_start = ?
          ORDER BY day, start`,
        [studentId, latest.week_start]
      );
      return res.json(rows || []);
    } catch (error) {
      console.error("❌ 스케줄 조회 오류:", error);
      return res
        .status(500)
        .json({ error: `서버 오류: 스케줄 조회 실패 (${error.message})` });
    }
  }

  router.get("/schedule/:id", fetchSchedules);
  router.get("/schedules/:id", fetchSchedules);

  /**
   * 최근 저장본 주차 3개 (버튼 목록용)
   * GET /saves/:studentId?limit=3
   * 응답: [{ week_start:"YYYY-MM-DD", saved_at:"ISO" }, ...]
   */
  router.get("/saves/:id", async (req, res) => {
    try {
      const studentId = req.params.id;
      const limit = Math.max(1, Math.min(10, parseInt(req.query.limit || "3", 10)));
      const rows = await db.all(
        `SELECT week_start, MAX(saved_at) AS saved_at
           FROM schedules
          WHERE student_id = ?
          GROUP BY week_start
          ORDER BY MAX(saved_at) DESC
          LIMIT ?`,
        [studentId, limit]
      );
      res.json(rows || []);
    } catch (error) {
      console.error("❌ 최근 저장본 조회 오류:", error);
      res.status(500).json({ error: "최근 저장본 조회 실패" });
    }
  });

  return router;
}
