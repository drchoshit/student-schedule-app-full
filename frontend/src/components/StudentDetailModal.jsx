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

  // ✅ 이번 주 일정: 엑셀과 동일하게 "센터/외부"만 표시 + 정렬 + 중복 제거
  const weekItems = useMemo(() => {
    const ACCEPT = new Set(["센터", "외부"]);
    const raw = Array.isArray(schedules?.schedule) ? schedules.schedule : [];

    // 1) 타입 정규화 후 허용 타입만 필터
    const normalized = raw
      .map((r) => ({
        ...r,
        type: String(r?.type || "").trim(),
      }))
      .filter((r) => ACCEPT.has(r.type));

    // 2) 중복 제거(day|start|end|type)
    const seen = new Set();
    const dedup = [];
    for (const r of normalized) {
      const key = [r.day, r.start, r.end, r.type].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(r);
    }

    // 3) 요일/시간 정렬
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

  // 문자 미리보기도 상세 표시와 동일한 데이터(센터/외부만) 사용
  const getSmsPreview = () => {
    const header = `[안내] ${editData.name}님의 이번 주 일정\n`;
    const lines = weekItems.map(
      (it) => `${it.day}: ${it.start} ~ ${it.end} (${it.type})`
    );
    const base = header + (lines.length ? lines.join("\n") : "등록된 스케줄이 없습니다.");
    const footer = [editData.smsNote, settings?.notification_footer].filter(Boolean).join("\n");
    return footer ? `${base}\n\n${footer}` : base;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-start z-50 p-4">
      {/* 모달 자체도 스크롤 가능하도록 높이 제한 */}
      <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">학생 상세 정보</h2>

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

        <div className="mb-4">
          <label className="block text-sm font-semibold">학생별 문자 메모 (smsNote)</label>
          <textarea
            value={editData.smsNote}
            onChange={(e) => setEditData({ ...editData, smsNote: e.target.value })}
            className="border p-2 rounded w-full h-20"
            placeholder="예: 식사 18:00 전/후 10분 이동, 지각시 연락 부탁"
          />
        </div>

        <div className="mb-4">
          <h3 className="font-semibold mb-2">이번 주 일정</h3>
          {weekItems.length > 0 ? (
            // 리스트 자체 스크롤 -> 하단 버튼 안 잘림
            <ul className="list-disc list-inside bg-gray-100 p-2 rounded max-h-48 overflow-y-auto">
              {weekItems.map((item, idx) => (
                <li key={`${item.day}-${item.start}-${item.end}-${item.type}-${idx}`}>
                  {item.day}: {item.start} ~ {item.end} ({item.type})
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">등록된 스케줄이 없습니다.</p>
          )}
        </div>

        <div className="mb-4">
          <h3 className="font-semibold mb-2">문자 발송 내용 미리보기</h3>
          <textarea readOnly className="border p-2 rounded w-full h-28 bg-gray-100" value={getSmsPreview()} />
        </div>

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

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={handleSave} className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600">저장</button>
          <button onClick={onClose} className="bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500">닫기</button>
        </div>
      </div>
    </div>
  );
}
