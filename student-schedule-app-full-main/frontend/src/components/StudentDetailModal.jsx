// src/components/StudentDetailModal.jsx
import React, { useMemo, useState } from "react";

export default function StudentDetailModal({
  isOpen,
  onClose,
  student,
  schedules,
  settings,
  onUpdateStudent,
  onSendSms
}) {
  if (!isOpen || !student) return null;

  const [editData, setEditData] = useState({
    id: student.id || "",
    name: student.name || "",
    grade: student.grade || "현역",
    seatNumber: student.seatNumber || "",
    studentPhone: student.studentPhone || "",
    parentPhone: student.parentPhone || "",
    smsNote: student.smsNote || ""
  });

  const handleSave = async () => {
    const payload = { ...student, ...editData };
    await onUpdateStudent(payload);
    onClose();
  };

  // ✅ 이번 주 일정 계산
  const weekItems = useMemo(() => {
    const ACCEPT = new Set(["센터", "외부"]);
    const raw = Array.isArray(schedules?.schedule) ? schedules.schedule : [];

    const normalized = raw
      .map((r) => ({
        ...r,
        type: String(r?.type || "").trim(),
        description: String(r?.description || "").trim(),
      }))
      .filter((r) => ACCEPT.has(r.type));

    const seen = new Set();
    const dedup = [];
    for (const r of normalized) {
      const key = [r.day, r.start, r.end, r.type, r.description].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(r);
    }

    const dayOrder = { "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6, "일": 7 };
    const toMin = (hhmm) => {
      const m = /^(\d{1,2}):(\d{1,2})$/.exec(hhmm || "");
      if (!m) return 0;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    };
    dedup.sort((a, b) => {
      const da = dayOrder[a.day] ?? 99;
      const db = dayOrder[b.day] ?? 99;
      if (da !== db) return da - db;
      return toMin(a.start) - toMin(b.start);
    });

    return dedup;
  }, [schedules]);

  // ✅ 문자 미리보기 (description 포함)
  const getSmsPreview = () => {
    const header = `[안내] ${editData.name}님의 이번 주 일정\n`;
    const lines = weekItems.map(
      (it) =>
        `${it.day}: ${it.start} ~ ${it.end} (${it.type}${
          it.description ? ` / ${it.description}` : ""
        })`
    );
    const base = header + (lines.length ? lines.join("\n") : "등록된 스케줄이 없습니다.");
    const footer = [editData.smsNote, settings?.notification_footer].filter(Boolean).join("\n");
    return footer ? `${base}\n\n${footer}` : base;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-start z-50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">학생 상세 정보</h2>

        {/* 기본 정보 입력 */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="col-span-2">
            <label className="block text-sm font-semibold">ID (읽기 전용)</label>
            <input type="text" value={editData.id} readOnly className="border p-2 rounded w-full bg-gray-100" />
          </div>
          <div>
            <label className="block text-sm font-semibold">이름</label>
            <input
              type="text"
              value={editData.name}
              onChange={(e) => setEditData({ ...editData, name: e.target.value })}
              className="border p-2 rounded w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold">학년</label>
            <select
              value={editData.grade}
              onChange={(e) => setEditData({ ...editData, grade: e.target.value })}
              className="border p-2 rounded w-full"
            >
              <option value="현역">현역</option>
              <option value="N수">N수</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold">좌석번호</label>
            <input
              type="text"
              value={editData.seatNumber}
              onChange={(e) => setEditData({ ...editData, seatNumber: e.target.value })}
              className="border p-2 rounded w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold">학생 전화번호</label>
            <input
              type="text"
              value={editData.studentPhone}
              onChange={(e) => setEditData({ ...editData, studentPhone: e.target.value })}
              className="border p-2 rounded w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold">보호자 전화번호</label>
            <input
              type="text"
              value={editData.parentPhone}
              onChange={(e) => setEditData({ ...editData, parentPhone: e.target.value })}
              className="border p-2 rounded w-full"
            />
          </div>
        </div>

        {/* 문자 메모 */}
        <div className="mb-4">
          <label className="block text-sm font-semibold">학생별 문자 메모 (smsNote)</label>
          <textarea
            value={editData.smsNote}
            onChange={(e) => setEditData({ ...editData, smsNote: e.target.value })}
            className="border p-2 rounded w-full h-20"
            placeholder="예: 식사 18:00 전/후 10분 이동, 지각시 연락 부탁"
          />
        </div>

        {/* ✅ 이번 주 일정 표시 (센터 + 외부 + description) */}
        <div className="mb-4">
          <h3 className="font-semibold mb-2">이번 주 일정</h3>
          {weekItems.length > 0 ? (
            <ul className="list-disc list-inside bg-gray-100 p-2 rounded max-h-48 overflow-y-auto">
              {weekItems.map((item, idx) => (
                <li
                  key={`${item.day}-${item.start}-${item.end}-${item.type}-${idx}`}
                  className={`p-1 rounded ${
                    item.type === "센터"
                      ? "text-blue-700"
                      : "text-orange-700"
                  }`}
                >
                  {item.day}: {item.start} ~ {item.end} ({item.type})
                  {item.description && (
                    <span className="text-gray-600 ml-1"> - {item.description}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">등록된 스케줄이 없습니다.</p>
          )}
        </div>

        {/* 문자 미리보기 */}
        <div className="mb-4">
          <h3 className="font-semibold mb-2">문자 발송 내용 미리보기</h3>
          <textarea readOnly className="border p-2 rounded w-full h-28 bg-gray-100" value={getSmsPreview()} />
        </div>

        {/* 문자 발송 버튼 */}
        <div className="flex justify-between mt-4">
          <button
            onClick={() => onSendSms({ ...student, ...editData }, "student")}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
          >학생에게 발송</button>
          <button
            onClick={() => onSendSms({ ...student, ...editData }, "parent")}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >보호자에게 발송</button>
          <button
            onClick={() => {
              onSendSms({ ...student, ...editData }, "student");
              onSendSms({ ...student, ...editData }, "parent");
            }}
            className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600"
          >전체 발송</button>
        </div>

        {/* 저장/닫기 */}
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={handleSave} className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600">저장</button>
          <button onClick={onClose} className="bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500">닫기</button>
        </div>
      </div>
    </div>
  );
}
