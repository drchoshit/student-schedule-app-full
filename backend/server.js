// ✅ 최상단에 추가하세요 (맨 위)
import dotenv from "dotenv";
import path from "path"; // ✅ path 모듈 추가
dotenv.config({ path: './backend/.env' }); // 경로 명시
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("📂 현재 실행 경로:", process.cwd());
console.log("✅ env 테스트 (API KEY):", process.env.COOLSMS_API_KEY || "값 없음");
console.log("✅ env 테스트 (SENDER):", process.env.COOLSMS_SENDER || "값 없음");

// ✅ 그 후에 다른 모듈 import
import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import adminRoutes from "./routes/admin.js";
import studentRoutes from "./routes/student.js";
import smsRoutes from "./routes/sms.js"; // ✅ 문자 발송 라우트 추가
import { execSync } from "child_process";

const app = express();  // ← 이 줄이 있어야 app.use(...) 호출 가능

// ✅ 배포 감지 기준 통일 (Render는 PORT를 항상 제공)
const isProduction = process.env.NODE_ENV === "production" || IS_RENDER;

if (!isProduction) {
  app.use(cors({ origin: "http://localhost:5173", credentials: true }));
} else {
  // 배포 환경: credentials 허용 + origin을 자동 설정
  app.use(cors({
    origin: true,  // 요청한 Origin을 그대로 반영
    credentials: true
  }));
}
app.use(express.json({ limit: "2mb" })); // ✅ JSON 바디 제한(필요 시 상향)

// **개발용 요청 로깅(선택)**
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      console.log(`[RES] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });
}

let db;

// ✅ 서버 시작 함수
const startServer = (port) => {
  const server = app.listen(port, () => {
    console.log("✅ Server running on port " + port);
  });

  server.on("error", (err) => {
    const isRender = IS_RENDER; // ✅ 기준 통일
    if (err.code === "EADDRINUSE" && !isRender) {
      console.log("⚠️ Port " + port + " is in use. Trying " + (port + 1) + "...");
      startServer(port + 1);
    } else {
      console.error("❌ Server error:", err);
      process.exit(1);
    }
  });
};

// ✅ 추가: 포트 5000 점유 중인지 확인 후 종료
const killProcessOnPort = (port) => {
  try {
    if (process.platform === "win32") {
      // ✅ Windows 환경
      const output = execSync(`netstat -ano | findstr :${port}`).toString();
      const lines = output.split("\n").filter((line) => line.includes("LISTENING"));
      if (lines.length > 0) {
        const pid = lines[0].trim().split(/\s+/).pop();
        execSync(`taskkill /PID ${pid} /F`);
        console.log(`✅ Killed process on port ${port} (PID: ${pid})`);
      } else {
        console.log(`✅ No process found on port ${port}`);
      }
    } else {
      // ✅ macOS / Linux
      execSync(`lsof -ti:${port} | xargs kill -9`);
      console.log(`✅ Killed process on port ${port}`);
    }
  } catch (err) {
    console.log(`✅ No existing process found on port ${port}`);
  }
};

// ✅ DB 초기화 후 서버 실행
(async () => {
  try {
    // ✅ 포트 5000 점유 중이면 강제 종료
    const isRender = !!process.env.RENDER;
    if (!isRender) killProcessOnPort(5000);

    // ⬇️ 로컬은 __dirname 기준으로 DB 파일 경로 고정 (상대경로 이슈 방지)
    const DB_FILE = process.env.RENDER
      ? "/data/database.sqlite"
      : path.join(__dirname, "database.sqlite");

    console.log("📄 DB file path (resolved):", DB_FILE);
    console.log("✅ NODE_ENV:", process.env.NODE_ENV);
    console.log("✅ RENDER flag:", process.env.RENDER);

    db = await open({
      filename: DB_FILE,
      driver: sqlite3.Database,
    });
    console.log("✅ Using DB file:", DB_FILE);

    // ✅ settings 테이블
    await db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_range_text TEXT,
        external_desc TEXT,
        external_example TEXT,
        center_desc TEXT,
        center_example TEXT,
        notification_footer TEXT
      )
    `);

    // ✅ students 테이블
    await db.exec(`
      CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        name TEXT,
        grade TEXT, 
        studentPhone TEXT,
        parentPhone TEXT
      )
    `);

    // ✅ schedules 테이블
    await db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT,
        student_code TEXT,
        day TEXT,
        start TEXT,
        end TEXT,
        type TEXT,
        description TEXT
      )
    `);

    // ✅ admins 테이블 (role 추가)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'admin'
      )
    `);

    // ✅ role 컬럼이 없으면 추가
    const columns = await db.all(`PRAGMA table_info(admins)`);
    const hasRole = columns.some((col) => col.name === "role");
    if (!hasRole) {
      await db.exec(`ALTER TABLE admins ADD COLUMN role TEXT DEFAULT 'admin'`);
      console.log("✅ role 컬럼 추가 완료");
    }

    // ✅ 관리자 계정 존재 여부 확인
    const adminExists = await db.get(`SELECT * FROM admins WHERE username = ?`, ["medicalsoap"]);

    const bcrypt = await import("bcrypt");
    const hashed = await bcrypt.hash("ghfkdskql2827", 10);

    if (!adminExists) {
      await db.run(
        `INSERT INTO admins (username, password, role) VALUES (?, ?, ?)`,
        ["medicalsoap", hashed, "superadmin"]
      );
      console.log("✅ 기본 관리자 계정 생성: medicalsoap / ghfkdskql2827");
    } else {
      await db.run(
        `UPDATE admins SET password = ?, role = ? WHERE username = ?`,
        [hashed, "superadmin", "medicalsoap"]
      );
      console.log("✅ 기존 관리자 계정 비밀번호 갱신 완료: medicalsoap / ghfkdskql2827");
    }

    console.log("✅ Database initialized successfully!");

    // ✅ 라우터 연결
    console.log("🔗 binding /api/admin ...");
    app.use("/api/admin", adminRoutes(db));     // 관리자용 API

    console.log("🔗 binding /api/student ...");
    app.use("/api/student", studentRoutes(db));

    console.log("🔗 binding /api/sms ...");
    app.use("/api/sms", smsRoutes);             // ⬅️ 주석 해제

    console.log("🔗 binding static & spa fallback ...");

    // (옵션) Health Check
    app.get("/healthz", (_req, res) => res.status(200).send("ok"));

    // ✅ 정적 파일 서빙(frontend/dist)
    const distPath = path.join(__dirname, "..", "frontend", "dist");
    app.use(express.static(distPath));

    // ✅ SPA 라우팅 폴백 (Express 5 안전: 미들웨어 버전만 사용)
    app.use((req, res, next) => {
      try {
        if (req.path && req.path.startsWith("/api")) return next();
        res.sendFile(path.join(distPath, "index.html"));
      } catch (e) {
        next(e);
      }
    });

    // ✅ 서버 고정 실행 (5000)
    const basePort = Number(process.env.PORT) || 5000;
    console.log(`✅ Starting server on port ${basePort}...`);
    startServer(basePort);
  } catch (err) {
    console.error("❌ Database initialization failed:", err);
  }
})();
