import React, { useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid"; // ✅ 추가
import interactionPlugin from "@fullcalendar/interaction"; // ✅ 추가

export default function CalendarModal({ isOpen, onClose, mode, students = [], events = [], onStudentSelect }) {
  const [selectedStudent, setSelectedStudent] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(null); // ✅ 이벤트 상세 보기 상태 추가
  const [dayEvents, setDayEvents] = useState([]); // ✅ 선택한 날짜의 모든 일정 리스트

  if (!isOpen) return null;

  const handleStudentChange = (e) => {
    const value = e.target.value;
    setSelectedStudent(value);
    if (onStudentSelect) onStudentSelect(value);
  };

  // ✅ 날짜 → "MM/DD(요일) HH:mm" 포맷
  const formatDateTime = (dateStr) => {
    const date = new Date(dateStr);
    const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dayName = dayNames[date.getDay()];
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${month}/${day}(${dayName}) ${hours}:${minutes}`;
  };

  // ✅ 이벤트 클릭 시 상세 모달
  const handleEventClick = (info) => {
    setSelectedEvent({
      title: info.event.title + (info.event.extendedProps.memo ? ` (${info.event.extendedProps.memo})` : ""),
      start: formatDateTime(info.event.startStr),
      end: formatDateTime(info.event.endStr)
    });
  };

  // ✅ 날짜 클릭 시 해당 날짜의 모든 일정 표시
  const handleDateClick = (info) => {
    const clickedDate = info.dateStr;
    const filteredEvents = events.filter(ev => ev.start.startsWith(clickedDate));
    setDayEvents(filteredEvents);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-lg p-6 w-11/12 max-w-6xl max-h-[90vh] overflow-auto">
        <h2 className="text-xl font-bold mb-4">
          {mode === "student" ? "학생 별 일정표" : "센터 재원 시간"} (월간 뷰)
        </h2>

        {mode === "student" && (
          <div className="mb-4">
            <label className="block mb-2 font-semibold">학생 선택:</label>
            <select
              value={selectedStudent}
              onChange={handleStudentChange}
              className="border p-2 rounded w-full"
            >
              <option value="">학생을 선택하세요</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name} ({student.id})
                </option>
              ))}
            </select>
          </div>
        )}

        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]} // ✅ 추가
          initialView="dayGridMonth"
          locale="ko"
          height="auto"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek" // ✅ 월간 + 주간 보기
          }}
          events={events}
          eventClick={handleEventClick} // ✅ 클릭 이벤트
          dateClick={handleDateClick} // ✅ 날짜 클릭 이벤트
        />

        {/* ✅ 이벤트 상세 정보 팝업 */}
        {selectedEvent && (
          <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div className="bg-white rounded shadow-lg p-4 w-96">
              <h3 className="text-lg font-semibold mb-2">일정 상세</h3>
              <p><strong>제목:</strong> {selectedEvent.title}</p>
              <p><strong>시작:</strong> {selectedEvent.start}</p>
              <p><strong>종료:</strong> {selectedEvent.end}</p>
              <div className="flex justify-end mt-4">
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ✅ 날짜 클릭 시 모든 일정 리스트 모달 */}
        {dayEvents.length > 0 && (
          <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div className="bg-white rounded shadow-lg p-4 w-[500px] max-h-[70vh] overflow-auto">
              <h3 className="text-lg font-semibold mb-4">선택한 날짜의 일정</h3>
              {dayEvents.map((ev, idx) => (
                <div key={idx} className="border-b py-2">
                  <p><strong>제목:</strong> {ev.title}</p>
                  <p><strong>시작:</strong> {formatDateTime(ev.start)}</p>
                  <p><strong>종료:</strong> {formatDateTime(ev.end)}</p>
                </div>
              ))}
              <div className="flex justify-end mt-4">
                <button
                  onClick={() => setDayEvents([])}
                  className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
