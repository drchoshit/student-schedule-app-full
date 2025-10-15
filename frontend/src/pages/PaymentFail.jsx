import React from "react";
import { Link } from "react-router-dom";

export default function PaymentFail(){
  const url = new URL(window.location.href);
  const message = url.searchParams.get("message") || "결제가 취소되었거나 실패했습니다.";

  return (
    <div className="card p-6">
      <div className="text-lg font-semibold text-rose-600">결제 실패</div>
      <div className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{message}</div>
      <Link to="/" className="btn-ghost mt-4">돌아가기</Link>
    </div>
  );
}
