// frontend/src/components/LiveWeekCalendar.jsx
import React, { useMemo } from "react";

/**
 * 간단 주간 캘린더
 * props:
 *  - weekStartYmd: "YYYY-MM-DD" (그 주의 월요일)
 *  - items: [{ day:"월"|"화"|...|"일", start:"HH:MM", end:"HH:MM", type:"센터"|"외부" }]
 *  - title?: string
 */
export default function LiveWeekCalendar({ weekStartYmd, items = [], title = "이번 주 캘린더" }) {
  const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
  const byDay = useMemo(() => {
    const map = Object.fromEntries(DAYS.map(d => [d, []]));
    (items || []).forEach(it => {
      if (!map[it.day]) return;
      map[it.day].push({
        ...it,
        key: `${it.day}-${it.start}-${it.end}-${it.type}`,
      });
    });
    // 시각 오름차순 정렬
    const toMin = (t) => {
      const m = /^(\d{1,2}):(\d{1,2})$/.exec(t || "");
      if (!m) return 0;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    };
    DAYS.forEach(d => map[d].sort((a, b) => toMin(a.start) - toMin(b.start)));
    return map;
  }, [items]);

  const dateLabels = useMemo(() => {
    // 주 시작일 라벨 만들기 (MM/DD)
    const out = [];
    const base = new Date(`${weekStartYmd}T00:00:00`);
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      out.push(`${d.getMonth() + 1}/${d.getDate()}`);
    }
    return out;
  }, [weekStartYmd]);

  return (
    <div className="mt-4 border rounded-lg overflow-hidden">
      <div className="px-3 py-2 font-semibold bg-gray-100 border-b">{title}</div>

      {/* 7열 주간 그리드 */}
      <div className="grid grid-cols-7 gap-0">
        {DAYS.map((d, idx) => (
          <div key={d} className="border-l first:border-l-0">
            <div className="px-2 py-1 text-center text-sm font-semibold bg-gray-50 border-b">
              {d}{dateLabels[idx] ? `(${dateLabels[idx]})` : ""}
            </div>

            {/* 각 요일의 아이템 목록 */}
            <div className="p-2 min-h-[120px] space-y-2">
              {byDay[d].length === 0 ? (
                <div className="text-xs text-gray-400 text-center">—</div>
              ) : (
                byDay[d].map(it => (
                  <div
                    key={it.key}
                    className={`text-xs px-2 py-1 rounded border
                      ${it.type === "센터" ? "bg-indigo-50 border-indigo-200" : "bg-teal-50 border-teal-200"}`}
                    title={`${it.type}`}
                  >
                    <div className="font-semibold">{it.start} ~ {it.end}</div>
                    <div className="text-[11px] opacity-70">{it.type}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
