import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";

export default function PaymentSuccess(){
  const [status, setStatus] = useState("processing");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);

  useEffect(()=>{
    (async ()=>{
      try{
        const url = new URL(window.location.href);
        const paymentKey = url.searchParams.get("paymentKey");
        const orderId = url.searchParams.get("orderId");
        const amount = url.searchParams.get("amount");
        const code = url.searchParams.get("code");
        // Student.jsx에서 붙여준 items(JSON)
        const itemsParam = url.searchParams.get("items");
        let dateslots = [];
        try{
          dateslots = JSON.parse(decodeURIComponent(itemsParam || "[]")) || [];
        }catch{ dateslots = []; }

        const resp = await api.post("/payments/toss/confirm", {
          paymentKey, orderId, amount: Number(amount || 0), code, dateslots
        });
        setReceipt(resp.data?.receipt || null);
        setStatus("done");
      }catch(e){
        console.error(e);
        setError(e?.response?.data?.error || e?.message || String(e));
        setStatus("fail");
      }
    })();
  },[]);

  if(status === "processing"){
    return (
      <div className="card p-6">
        <div className="text-lg font-semibold">결제 승인 중…</div>
        <div className="text-slate-500 mt-1">잠시만 기다려 주세요.</div>
      </div>
    );
  }

  if(status === "fail"){
    return (
      <div className="card p-6">
        <div className="text-lg font-semibold text-rose-600">결제 승인 실패</div>
        <div className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{error}</div>
        <Link to="/" className="btn-ghost mt-4">돌아가기</Link>
      </div>
    );
  }

  // done
  return (
    <div className="card p-6">
      <div className="text-lg font-semibold">결제가 완료되었습니다 🎉</div>
      {receipt ? (
        <div className="text-sm text-slate-600 mt-3">
          <div>결제수단: {receipt?.method || "카드"}</div>
          <div>승인금액: {Number(receipt?.totalAmount || 0).toLocaleString()}원</div>
          <div className="mt-2">
            <a
              className="btn-ghost"
              href={receipt?.checkout?.url || receipt?.receipt?.url || "#"}
              target="_blank" rel="noreferrer"
            >
              영수증 보기
            </a>
          </div>
        </div>
      ) : (
        <div className="text-sm text-slate-600 mt-3">승인 내역을 불러왔습니다.</div>
      )}
      <Link to="/" className="btn-primary mt-4">홈으로</Link>
    </div>
  );
}
