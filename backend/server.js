// ✅ 최상단에 추가하세요 (맨 위)
import dotenv from "dotenv";
import path from "path"; // ✅ path 모듈 추가
dotenv.config({ path: './backend/.env' }); // 경로 명시
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IS_RENDER = !!process.env.PORT; // ✅ 추가

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
  app.use(cors({
    origin: true,
    credentials: true
  }));
}
app.use(express.json({ limit: "2mb" }));

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

const startServer = (port) => {
  const server = app.listen(port, () => {
    console.log("✅ Server running on port " + port);
  });
  server.on("error", (err) => {
    const isRender = IS_RENDER;
    if (err.code === "EADDRINUSE" && !isRender) {
      console.log("⚠️ Port " + port + " is in use. Trying " + (port + 1) + "...");
      startServer(port + 1);
    } else {
      console.error("❌ Server error:", err);
      process.exit(1);
    }
  });
};

const killProcessOnPort = (port) => {
  try {
    if (process.platform === "win32") {
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
      execSync(`lsof -ti:${port} | xargs kill -9`);
      console.log(`✅ Killed process on port ${port}`);
    }
  } catch {
    console.log(`✅ No existing process found on port ${port}`);
  }
};

(async () => {
  try {
    const isRender = !!process.env.RENDER;
    if (!isRender) killProcessOnPort(5000);

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

    await db.exec(`
      CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        name TEXT,
        grade TEXT, 
        studentPhone TEXT,
        parentPhone TEXT
      )
    `);

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

    const schedCols = await db.all(`PRAGMA table_info(schedules)`);
    const hasWeekStart = schedCols.some((c) => c.name === "week_start");
    const hasSavedAt   = schedCols.some((c) => c.name === "saved_at");

    if (!hasWeekStart) {
      await db.exec(`ALTER TABLE schedules ADD COLUMN week_start TEXT`);
      console.log("✅ schedules.week_start 컬럼 추가");
    }
    if (!hasSavedAt) {
      await db.exec(`ALTER TABLE schedules ADD COLUMN saved_at TEXT`);
      console.log("✅ schedules.saved_at 컬럼 추가");
    }

    await db.exec(`
      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'admin'
      )
    `);

    const columns = await db.all(`PRAGMA table_info(admins)`);
    const hasRole = columns.some((col) => col.name === "role");
    if (!hasRole) {
      await db.exec(`ALTER TABLE admins ADD COLUMN role TEXT DEFAULT 'admin'`);
      console.log("✅ role 컬럼 추가 완료");
    }

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
      console.log("✅ 기존 관리자 계정 비밀번호 갱신 완료");
    }

    console.log("✅ Database initialized successfully!");

    // ✅ 라우터 연결
    console.log("🔗 binding /api/admin ...");
    app.use("/api/admin", adminRoutes(db));

    console.log("🔗 binding /api/student ...");
    app.use("/api/student", studentRoutes(db));

    console.log("🔗 binding /api/sms ...");
    app.use("/api/sms", smsRoutes);

    console.log("🔗 binding static & spa fallback ...");

    app.get("/healthz", (_req, res) => res.status(200).send("ok"));

    const distPath = path.join(__dirname, "..", "frontend", "dist");
    app.use(express.static(distPath));

    app.use((req, res, next) => {
      try {
        if (req.path && req.path.startsWith("/api")) return next();
        res.sendFile(path.join(distPath, "index.html"));
      } catch (e) {
        next(e);
      }
    });

    const basePort = Number(process.env.PORT) || 5000;
    console.log(`✅ Starting server on port ${basePort}...`);
    startServer(basePort);

    // ✅ ✅ ✅ [여기 아래에 추가] ===================================
    // 🔥 관리자 긴급 리셋용 라우트
    app.delete("/api/admin/schedules/clear-all", async (req, res) => {
      try {
        console.log("⚠️ 일정 전체 삭제 요청 수신됨.");

        const dbConn = await open({
          filename: DB_FILE,
          driver: sqlite3.Database,
        });

        // 전체 일정 삭제
        await dbConn.run("DELETE FROM schedules");
        await dbConn.run("DELETE FROM sqlite_sequence WHERE name='schedules'");

        await dbConn.close();

        console.log("🧹 모든 일정 데이터가 관리자에 의해 초기화되었습니다.");
        res.json({ success: true, message: "모든 일정이 삭제되었습니다." });
      } catch (err) {
        console.error("❌ 전체 일정 삭제 오류:", err);
        res.status(500).json({ success: false, message: "삭제 중 오류 발생" });
      }
    });
    // ✅ ✅ ✅ [추가 끝] ===========================================
  } catch (err) {
    console.error("❌ Database initialization failed:", err);
  }
})();
