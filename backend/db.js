// backend/db.js  — server-safe persistent DB (better-sqlite3)
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Render 등에서 Persistent Disk를 /data에 마운트했다면 그 경로 사용
const useDataDir =
  process.env.NODE_ENV === 'production' && fs.existsSync('/data');

const DB_PATH = useDataDir
  ? path.resolve('/data', 'data.sqlite')           // 배포(디스크)용
  : path.resolve(__dirname, 'data.sqlite');        // 로컬/백엔드 폴더 고정

// DB 오픈 (동기, 안정)
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// 스키마 보장
db.exec(`
  CREATE TABLE IF NOT EXISTS students(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    parent_phone TEXT,
    allowed_weekdays TEXT,
    start_date TEXT,
    end_date TEXT,
    price_override INTEGER
  );

  CREATE TABLE IF NOT EXISTS policy(
    id INTEGER PRIMARY KEY CHECK (id=1),
    base_price INTEGER DEFAULT 9000,
    allowed_weekdays TEXT DEFAULT 'MON,TUE,WED,THU,FRI',
    start_date TEXT,
    end_date TEXT,
    sms_extra_text TEXT
  );
  INSERT OR IGNORE INTO policy(id, base_price, allowed_weekdays)
  VALUES (1, 9000, 'MON,TUE,WED,THU,FRI');

  CREATE TABLE IF NOT EXISTS orders(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    slot TEXT NOT NULL CHECK (slot IN ('LUNCH','DINNER')),
    price INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('SELECTED','PAID')),
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(student_id, date, slot),
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_orders_date_slot
    ON orders(date, slot, status);
  CREATE INDEX IF NOT EXISTS idx_orders_student_date
    ON orders(student_id, date);

  CREATE TABLE IF NOT EXISTS menu_images(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    uploaded_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS blackout(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    slot TEXT NOT NULL CHECK (slot IN ('BOTH','LUNCH','DINNER'))
  );
`);

// 헬퍼 (server.js와 시그니처 동일)
export function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}
export function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}
export function run(sql, params = []) {
  try {
    return db.prepare(sql).run(...params);
  } catch (err) {
    // 🔥 DB 오류 로그: Render에서 서버 죽지 않게
    console.error("[DB RUN ERROR]", err.message, sql, params);
    throw err; // server.js 쪽 try/catch에서 처리됨
  }
}

export default db;
