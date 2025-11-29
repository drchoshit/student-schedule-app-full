// backend/middleware/auth.js
import jwt from "jsonwebtoken";

/**
 * 관리자 인증 미들웨어
 * - Authorization: Bearer <JWT> 헤더 확인
 * - 유효하면 req.admin = { id, username, role, ... } 주입
 * - 에러 시 401 (미인증) 로 통일해 프론트에서 "재로그인" 흐름으로 처리하기 쉽게 함
 */
export function verifyToken(req, res, next) {
  try {
    // 1) Authorization 헤더 안전 파싱 (대소문자/공백/포맷 모두 대응)
    const auth = req.headers?.authorization || "";
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    if (!match) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }

    const token = match[1].trim();
    if (!token) {
      return res.status(401).json({ error: "Empty token" });
    }

    // 2) 토큰 검증
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("verifyToken error: JWT_SECRET is not set");
      return res.status(500).json({ error: "Server JWT not configured" });
    }

    const decoded = jwt.verify(token, secret);
    // 정상: 요청 컨텍스트에 주입
    req.admin = decoded; // { id, username, role, iat, exp, ... }
    return next();
  } catch (err) {
    // 만료/서명 오류 구분 로그
    if (err?.name === "TokenExpiredError") {
      console.warn("verifyToken: token expired");
      return res.status(401).json({ error: "Token expired" });
    }
    if (err?.name === "JsonWebTokenError") {
      console.warn("verifyToken: invalid token");
      return res.status(401).json({ error: "Invalid token" });
    }

    console.error("verifyToken unknown error:", err?.message || err);
    return res.status(401).json({ error: "Unauthorized" });
  }
}

/**
 * alias (기존 파일명/함수명과의 호환을 위해 유지)
 * - 다른 파일에서 authenticateAdmin 이름으로 import 하더라도 동작하도록 함
 */
export const authenticateAdmin = verifyToken;

// 선택: default export도 유지(원한다면)
export default verifyToken;
