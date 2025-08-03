import express from "express";
import pkg from "../services/smsService.js";
const { sendSMS } = pkg;

/**
 * 학생 관련 라우트
 * - 로그인: 이름+코드(=id) 일치해야 통과
 * - 설정 조회: settings 최신 레코드 반환
 * - 스케줄 저장: 기존 삭제 후 일괄 삽입(트랜잭션)
 * - 스케줄 조회: 학생별 스케줄 목록
 *
 * 주의:
 * - settings 테이블은 다음 컬럼만 사용합니다:
 *   week_range_text, external_desc, external_example,
 *   center_desc, center_example, notification_footer
 * - 관리자 알림용 SMS 수신 번호는 환경변수 사용:
 *   COOLSMS_ADMIN1, COOLSMS_ADMIN2
 */
export default function studentRoutes(db) {
  const router = express.Router();

    // ✅ 학생용 설정 조회 라우트 추가
    router.get("/settings", async (req, res) => {
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
    
  /* ✅ 학생 로그인: 이름 + 코드(=id) 둘 다 일치해야만 통과 */
  router.post("/login", async (req, res) => {
    try {
      const { name, code } = req.body;
      if (!name || !code) {
        return res.status(400).json({ error: "이름과 코드를 모두 입력하세요." });
      }

      // id(=코드)와 name 모두 일치하는 학생만 로그인
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
      return res
        .status(500)
        .json({ error: `서버 오류: 로그인 실패 (${error.message})` });
    }
  });

  /* ✅ 학생용: 최신 설정 조회 (Admin에서 저장한 마지막 레코드) */
  router.get("/settings", async (_req, res) => {
    try {
      const row = await db.get(
        `SELECT
           week_range_text,
           external_desc,
           external_example,
           center_desc,
           center_example,
           notification_footer
         FROM settings
         ORDER BY id DESC
         LIMIT 1`
      );
      return res.json(row || {});
    } catch (error) {
      console.error("❌ 학생 설정 조회 오류:", error);
      return res
        .status(500)
        .json({ error: `서버 오류: 설정 조회 실패 (${error.message})` });
    }
  });

  /* ✅ 스케줄 저장 (전체 교체, 트랜잭션 사용) */
  router.post("/schedule", async (req, res) => {
    const tx = db; // sqlite 'open'으로 얻은 핸들: exec/prepare/ run 사용
    const { student_id, schedules } = req.body; // ← 키 이름 **student_id** 유지

    if (!student_id || !Array.isArray(schedules)) {
      return res.status(400).json({ error: "유효하지 않은 요청입니다." });
    }

    // 간단 검증: 배열 요소의 필수 필드 확인
    const invalid = schedules.some(
      (s) => !s || !s.day || !s.start || !s.end
    );
    if (invalid) {
      return res.status(400).json({ error: "스케줄 항목에 day/start/end가 모두 필요합니다." });
    }

    try {
      await tx.exec("BEGIN");

      // 기존 스케줄 삭제
      await tx.run("DELETE FROM schedules WHERE student_id = ?", [student_id]);

      // 일괄 삽입 (prepare로 성능/안전성 확보)
      const stmt = await tx.prepare(
        `INSERT INTO schedules
           (student_id, student_code, day, start, end, type, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      for (const s of schedules) {
        await stmt.run([
          student_id,
          student_id,                    // student_code = student_id와 동일 저장
          String(s.day).trim(),          // day
          String(s.start).trim(),        // start HH:MM
          String(s.end).trim(),          // end HH:MM
          (s.type ?? "").toString().trim(),
          (s.description ?? "").toString().trim(),
        ]);
      }
      await stmt.finalize();
      await tx.exec("COMMIT");

      // (선택) 관리자에게 요약 SMS — 환경변수 사용
      try {
        const ADMIN1 = process.env.COOLSMS_ADMIN1 || "";
        const ADMIN2 = process.env.COOLSMS_ADMIN2 || "";
        if (ADMIN1 || ADMIN2) {
          const summary = schedules
            .map((s) => `${s.day}: ${s.start}-${s.end}`)
            .join(", ");
          const message = `학생 ${student_id} 일정 저장: ${summary}`;
          if (ADMIN1) await sendSMS(ADMIN1, message);
          if (ADMIN2) await sendSMS(ADMIN2, message);
          return res.json({ success: true, message: "✅ 스케줄 저장 & SMS 발송 완료" });
        }
      } catch (smsError) {
        console.error("⚠️ SMS 발송 오류:", smsError.message);
        return res.json({ success: true, message: "✅ 스케줄 저장 완료 (SMS 발송 실패)" });
      }

      // SMS 미설정 시
      return res.json({ success: true, message: "✅ 스케줄 저장 완료" });
    } catch (error) {
      try {
        await tx.exec("ROLLBACK");
      } catch (_) {}
      console.error("❌ 스케줄 저장 오류:", error);
      return res
        .status(500)
        .json({ error: `서버 오류: 스케줄 저장 실패 (${error.message})` });
    }
  });

  /* ✅ 학생 스케줄 조회 */
  router.get("/schedule/:id", async (req, res) => {
    try {
      const studentId = req.params.id;
      const rows = await db.all(
        "SELECT id, student_id, day, start, end, type, description FROM schedules WHERE student_id = ? ORDER BY day, start",
        [studentId]
      );
      return res.json(rows || []);
    } catch (error) {
      console.error("❌ 스케줄 조회 오류:", error);
      return res
        .status(500)
        .json({ error: `서버 오류: 스케줄 조회 실패 (${error.message})` });
    }
  });

  return router;
}
