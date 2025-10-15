import sqlite3 from "sqlite3";
import { open } from "sqlite";

(async () => {
  try {
    const db = await open({
      filename: "./database.sqlite",
      driver: sqlite3.Database,
    });

    console.log("⏳ Resetting database...");

    // ✅ 기존 테이블 삭제
    await db.exec(`
      DROP TABLE IF EXISTS settings;
      DROP TABLE IF EXISTS students;
      DROP TABLE IF EXISTS schedules;
    `);

    // ✅ 새 테이블 생성
    await db.exec(`
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_range_text TEXT,
        external_desc TEXT,
        external_example TEXT,
        center_desc TEXT,
        center_example TEXT,
        notification_footer TEXT -- ✅ 새로 추가 (관리자 알림 메시지)
      );
    `);

    await db.exec(`
      CREATE TABLE students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE,
        name TEXT
      );
    `);

    await db.exec(`
      CREATE TABLE schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        student_code TEXT,  -- ✅ student_code 컬럼 추가 (중요!)
        day TEXT,
        start TEXT,
        end TEXT,
        type TEXT,
        description TEXT
      );
    `);

    console.log("✅ Database reset complete! (스키마 최신 적용, notification_footer 추가됨)");
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed to reset database:", err);
    process.exit(1);
  }
})();
