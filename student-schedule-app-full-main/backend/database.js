import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

/**
 * DB 초기화 & 핸들 반환
 * - Render(배포): /data/database.sqlite
 * - Local(개발):  ./database.sqlite
 * - server.js 와 동일 스키마를 보장
 */
export async function initDB() {
  const IS_RENDER = !!process.env.PORT; // Render는 PORT 환경변수 항상 존재
  const DB_FILE = IS_RENDER ? "/data/database.sqlite" : "./database.sqlite";

  // 🔥 핵심: DB 디렉터리 보장 (Render Disk 대응)
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database,
  });

  // 외래키 사용시 활성화(현재 스키마에 강제 FK는 없음)
  await db.exec(`PRAGMA foreign_keys = ON;`);

  // =========================
  // 1) settings 테이블
  // =========================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_range_text TEXT,
      external_desc TEXT,
      external_example TEXT,
      center_desc TEXT,
      center_example TEXT,
      notification_footer TEXT
    );
  `);

  // 기본값 1회 삽입 (비어 있을 때만)
  const settingsCount = await db.get(`SELECT COUNT(*) AS cnt FROM settings;`);
  if ((settingsCount?.cnt ?? 0) === 0) {
    await db.run(
      `
      INSERT INTO settings (
        week_range_text,
        external_desc,
        external_example,
        center_desc,
        center_example,
        notification_footer
      ) VALUES (?, ?, ?, ?, ?, ?);
      `,
      [
        "📅 이번 주",
        "학교, 학원, 과외 등 원 외 활동을 입력해주세요.",
        "예: 월: 08:00~16:00 학교 / 20:00~22:00 학원",
        "메디컬로드맵에서 학생이 머무르는 시간입니다. 이동시간 제외.",
        "예: 17:00~19:30",
        "", // notification_footer 기본값
      ]
    );
  }

  // =========================
  // 2) students 테이블
  // =========================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT,
      grade TEXT,
      studentPhone TEXT,
      parentPhone TEXT
    );
  `);

  // =========================
  // 3) schedules 테이블
  // =========================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT,
      student_code TEXT,
      day TEXT,
      start TEXT,
      end TEXT,
      type TEXT,
      description TEXT,
      week_start TEXT,
      saved_at TEXT,
      UNIQUE(student_id, week_start, day, start)
    );
  `);

  // ✅ 구버전 schedules 테이블 컬럼 보정
  const scheduleCols = await db.all(`PRAGMA table_info(schedules);`);
  const colNames = scheduleCols.map((c) => c.name);

  if (!colNames.includes("week_start")) {
    await db.exec(`ALTER TABLE schedules ADD COLUMN week_start TEXT;`);
  }
  if (!colNames.includes("saved_at")) {
    await db.exec(`ALTER TABLE schedules ADD COLUMN saved_at TEXT;`);
  }

  // =========================
  // 4) admins 테이블
  // =========================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'admin'
    );
  `);

  // role 컬럼 존재 보장 (구버전 대비)
  const adminCols = await db.all(`PRAGMA table_info(admins);`);
  const hasRole = adminCols.some((c) => c.name === "role");
  if (!hasRole) {
    await db.exec(`ALTER TABLE admins ADD COLUMN role TEXT DEFAULT 'admin';`);
  }

  return db;
}
