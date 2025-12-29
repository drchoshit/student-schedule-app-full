// check-students.js
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// 현재 경로 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'backend', 'database.sqlite');

const db = new sqlite3.Database(dbPath);

db.all("SELECT * FROM students", [], (err, rows) => {
  if (err) {
    console.error("❌ DB 조회 오류:", err.message);
    return;
  }
  console.log("✅ 학생 목록:", rows);
  db.close();
});
