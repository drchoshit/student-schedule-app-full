import express from "express";
import { SolapiMessageService } from "solapi";

const router = express.Router();

// ✅ 환경 변수에서 불러오기
const apiKey = process.env.COOLSMS_API_KEY;
const apiSecret = process.env.COOLSMS_API_SECRET;
const senderNumber = (process.env.COOLSMS_SENDER || "").replace(/[^0-9]/g, "");

const messageService = new SolapiMessageService(apiKey, apiSecret);

router.post("/send", async (req, res) => {
  try {
    const { to, text } = req.body;

    if (!to || !text) {
      return res.status(400).json({ success: false, error: "전화번호 또는 메시지가 없습니다." });
    }

    const result = await messageService.sendOne({
      to,
      from: senderNumber,
      text
    });

    console.log("✅ 문자 전송 성공:", result);
    res.json({ success: true, result });
  } catch (error) {
    console.error("❌ 문자 전송 에러:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Unknown error"
    });
  }
});

export default router;
