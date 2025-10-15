import dotenv from "dotenv";
dotenv.config({ path: "./backend/.env" });

import { SolapiMessageService } from "solapi";

const apiKey = process.env.COOLSMS_API_KEY;
const apiSecret = process.env.COOLSMS_API_SECRET;
const sender = (process.env.COOLSMS_SENDER || "").replace(/[^0-9]/g, "");

console.log("✅ ENV 확인:", { apiKey, secret: apiSecret, sender });

const messageService = new SolapiMessageService(apiKey, apiSecret);

export async function sendSMS(to, text) {
  try {
    console.log("📤 문자 발송 요청 → from:", sender);
    console.log("📨 전송 대상 번호:", to);

    const result = await messageService.sendOne({
      to,
      from: sender,
      text
    });

    console.log("✅ SMS 발송 성공:", result);
    return result;
  } catch (error) {
    console.error("❌ 문자 전송 중 오류 발생");
    console.error("전체 오류 객체:", JSON.stringify(error, null, 2));
    throw error;
  }
}

export default { sendSMS };
