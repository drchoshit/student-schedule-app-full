import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

export default function adminAuthRoutes(db) {
  const router = express.Router();
  const JWT_SECRET = process.env.JWT_SECRET || "super_secret_key";

  // ✅ 관리자 로그인 API
  router.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
      // ✅ DB에서 관리자 계정 조회
      const admin = await db.get("SELECT * FROM admin LIMIT 1");

      if (!admin) {
        return res.status(500).json({ error: "관리자 계정이 존재하지 않습니다." });
      }

      if (username !== admin.username) {
        return res.status(401).json({ error: "아이디가 올바르지 않습니다." });
      }

      // ✅ 비밀번호 검증
      const isMatch = await bcrypt.compare(password, admin.password);
      if (!isMatch) {
        return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
      }

      // ✅ JWT 토큰 발급
      const token = jwt.sign({ username: admin.username }, JWT_SECRET, { expiresIn: "6h" });
      res.json({ token });
    } catch (err) {
      console.error("❌ 로그인 오류:", err.message);
      res.status(500).json({ error: "로그인 중 서버 오류" });
    }
  });

  // ✅ 관리자 비밀번호 변경 API
  router.post("/update-password", verifyToken, async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "비밀번호가 필요합니다." });

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.run("UPDATE admin SET password = ? WHERE id = 1", [hashedPassword]);
      res.json({ success: true, message: "비밀번호 변경 완료" });
    } catch (err) {
      console.error("❌ 비밀번호 변경 오류:", err.message);
      res.status(500).json({ error: "비밀번호 변경 실패" });
    }
  });

  return router;
}

// ✅ JWT 검증 미들웨어
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "토큰 없음" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "super_secret_key");
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: "토큰이 유효하지 않습니다." });
  }
}

// ✅ verifyToken을 export
export { verifyToken };
