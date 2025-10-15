import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../lib/api";

const SLOT_LABEL = { LUNCH: "점심", DINNER: "저녁" };

export default function OrdersPage() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  // groups: [{ student_id, name, code, total_amount, count, items:[{id,date,slot,price,status}] }]
  const [groups, setGroups] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      if (q.trim()) params.set("q", q.trim());
      const res = await api.get(
        "/admin/orders" + (params.toString() ? "?" + params.toString() : "")
      );
      setGroups(res.data?.groups || []);
    } catch (e) {
      console.error(e);
      alert("신청 리스트를 가져오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [start, end, q]);

  // 초기 1회 불러오기
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalAll = useMemo(
    () => groups.reduce((sum, g) => sum + (Number(g.total_amount) || 0), 0),
    [groups]
  );

  // ▶ 단건 취소(상태와 무관)
  async function cancelOne(orderId) {
    if (!confirm("해당 끼 신청을 삭제할까요? (결제/미결제 모두 즉시 삭제됩니다)")) return;
    try {
      await api.delete(`/admin/orders/${orderId}`);
      await load();
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || "취소 실패";
      alert("취소 실패: " + msg);
    }
  }

  // ▶ 학생 단위 일괄 취소(상태와 무관)
  async function cancelStudent(code, slotFilter) {
    const text = slotFilter
      ? `이 학생의 ${SLOT_LABEL[slotFilter]} 신청을`
      : "이 학생의 모든 신청을";
    if (!confirm(`${text} 삭제할까요? (결제/미결제 모두 삭제됩니다)`)) return;
    try {
      await api.post("/admin/orders/cancel-student", {
        code,
        start: start || undefined,
        end: end || undefined,
        slot: slotFilter || undefined,
      });
      await load();
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || "취소 실패";
      alert("취소 실패: " + msg);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h1 className="text-lg font-bold">신청 리스트</h1>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
          <label className="text-sm">
            시작일
            <input
              type="date"
              className="mt-1 input"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="text-sm">
            종료일
            <input
              type="date"
              className="mt-1 input"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <label className="text-sm">
            검색(이름/코드)
            <input
              className="mt-1 input"
              placeholder="예: 홍길동 / abc123"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button className="btn" onClick={load} disabled={loading}>
              {loading ? "불러오는 중…" : "불러오기"}
            </button>
            <a className="btn-ghost" href="/admin">
              ← 관리자 홈
            </a>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div className="text-slate-600 text-sm">총 금액</div>
          <div className="text-xl font-bold">
            {totalAll.toLocaleString()}원
          </div>
        </div>

        <div className="mt-4 space-y-8">
          {groups.map((g) => (
            <div key={g.student_id} className="border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 flex flex-wrap items-center gap-3">
                <div className="font-bold">
                  {g.name} <span className="text-slate-500">({g.code})</span>
                </div>
                <div className="text-sm text-slate-600">
                  총 {g.count}식 / {Number(g.total_amount).toLocaleString()}원
                </div>
                <div className="grow" />
                <button
                  className="btn-ghost"
                  onClick={() => cancelStudent(g.code)}
                >
                  학생 전체 취소
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => cancelStudent(g.code, "LUNCH")}
                >
                  점심만 취소
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => cancelStudent(g.code, "DINNER")}
                >
                  저녁만 취소
                </button>
              </div>

              <table className="w-full text-sm">
                <thead className="bg-white">
                  <tr>
                    <th className="p-2 border text-left">날짜</th>
                    <th className="p-2 border text-center">구분</th>
                    <th className="p-2 border text-right">가격</th>
                    <th className="p-2 border text-center">상태</th>
                    <th className="p-2 border text-center">취소</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it) => (
                    <tr key={it.id} className="hover:bg-slate-50">
                      <td className="p-2 border">{it.date}</td>
                      <td className="p-2 border text-center">
                        {SLOT_LABEL[it.slot] || it.slot}
                      </td>
                      <td className="p-2 border text-right">
                        {Number(it.price || 0).toLocaleString()}원
                      </td>
                      <td className="p-2 border text-center">
                        {it.status === "PAID" ? (
                          <span className="text-emerald-600 font-semibold">
                            결제
                          </span>
                        ) : (
                          <span className="text-slate-600">미결제</span>
                        )}
                      </td>
                      <td className="p-2 border text-center">
                        <button
                          className="btn-ghost text-danger"
                          onClick={() => cancelOne(it.id)}
                        >
                          취소
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!g.items.length && (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-3 text-center text-slate-500"
                      >
                        신청 내역이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}

          {!groups.length && (
            <div className="text-center text-slate-500">
              표시할 신청 내역이 없습니다. (필터를 변경해 보세요)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
