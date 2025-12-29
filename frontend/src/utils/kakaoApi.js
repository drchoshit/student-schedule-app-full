// frontend/src/utils/kakaoApi.js
import axios from "axios";

/**
 * 카카오톡 메시지 발송 API 호출
 * @param {string} to - 수신자 전화번호
 * @param {string} message - 발송할 메시지 내용
 * @returns {Promise<Object>} API 응답 데이터
 */
export const sendKakaoMessage = async (to, message) => {
  try {
    const response = await axios.post("/api/notify/kakao", { to, message });
    return response.data;
  } catch (error) {
    console.error("카카오톡 발송 오류:", error);
    throw error;
  }
};
