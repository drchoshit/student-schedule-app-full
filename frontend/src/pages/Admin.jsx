import React, { useEffect, useMemo, useState } from 'react';
import api, { adminAPI, studentAPI } from "../lib/api"; // ← 여기!
import { Printer, Settings, CalendarDays, Trash2, LogOut, Save, CheckSquare, Square } from 'lucide-react';


const DAY_LABELS = ['일','월','화','수','목','금','토'];
const DAY_CODES  = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

export default function Admin(){
  // --- Auth state ---
  const [isAuthed, setIsAuthed] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  // --- Data states ---
  const [students,setStudents]=useState([]);
  const [policy,setPolicy]=useState(null);
  const [img,setImg]=useState(null);
  const [images,setImages]=useState([]);
  const [nosvc,setNosvc]=useState([]);
  const [boDate,setBoDate]=useState('');

  const [weekStart,setWeekStart]=useState('');
  const [weekEnd,setWeekEnd]=useState('');
  const [weekly,setWeekly]=useState(null);

  const [showStudents,setShowStudents]=useState(true);
  const [newStu,setNewStu]=useState({name:'',code:'',phone:'',parent_phone:''});

  const [boSlot,setBoSlot]=useState('BOTH');
  const [search,setSearch]=useState('');
  const [saving, setSaving] = useState(false);

  // --- 신청자 결제 체크(기간 단위, 학생 단일 체크) ---
  const [appStart, setAppStart] = useState('');
  const [appEnd, setAppEnd] = useState('');
  /**
   * rows 스키마(신규):
   * {
   *   id, name, code,
   *   applied_count: number,   // 기간 내 신청한 총 식수(점+저)
   *   paid_count: number,      // 기간 내 결제된 총 식수
   *   total_amount: number,    // 결제해야 할 총 금액(기본가/개별가 반영)
   *   paid: boolean            // 학생 단위: 기간 내 신청분이 모두 결제되었는지
   * }
   */
  const [appRows, setAppRows] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsDirty, setAppsDirty] = useState(false);

  // ---- 최초 로그인 상태 확인 ----
  useEffect(() => {
    (async () => {
      try {
        const { data } = await adminAPI.me();
        const ok = !!data?.authenticated;
        setIsAuthed(ok);
        if (ok) await load();
      } catch {
        setIsAuthed(false);
      }
    })();
  }, []);

  // ---- 인증 후 데이터 로드 ----
  useEffect(() => {
    if (isAuthed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  async function load(){
    const s=await api.get('/admin/students'); setStudents(s.data);
    const p=await api.get('/admin/policy'); setPolicy(p.data);
    const b=await api.get('/admin/no-service-days'); setNosvc(b.data);
    const imgs=await api.get('/admin/menu-images'); setImages(imgs.data);
  }

  // --- Auth handlers ---
  async function handleLogin(e){
    e?.preventDefault();
    setLoginError('');
    try{
      await adminAPI.login(loginForm.username, loginForm.password);
      setIsAuthed(true);
      await load();
    }catch(err){
      setIsAuthed(false);
      setLoginError('아이디 또는 비밀번호가 올바르지 않습니다.');
    }
  }
  async function handleLogout(){
    try { await adminAPI.logout(); } catch {}
    setIsAuthed(false);
    setStudents([]); setPolicy(null); setImages([]); setNosvc([]);
    setWeekly(null);
  }

  // --- KPI / 필터 ---
  const filtered=students.filter(s=>(`${s.name||''}${s.code||''}`).toLowerCase().includes(search.toLowerCase()));
  const kpi=useMemo(()=>({students:students.length,nosvc:nosvc.length,price:policy?.base_price||9000}),[students,nosvc,policy]);

  // ---- EXCEL 미리보기(저장 X) ----
  async function previewExcelFile(file){
    if(!file) return;
    try{
      const fd = new FormData();
      fd.append('file', file);
      const resp = await api.post('/admin/students/preview-excel', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const arr = resp.data?.students || [];
      const mapped = arr.map((s,idx)=>({
        id: `tmp-${idx}`,
        name: s.name || '',
        code: s.code || '',
        phone: s.studentPhone || '',
        parent_phone: s.parentPhone || '',
        allowed_weekdays: '',
        start_date: '',
        end_date: '',
        price_override: null
      }));
      setStudents(mapped);
      alert(`엑셀에서 ${mapped.length}명의 학생을 불러왔습니다. (미리보기)\n\n상단 '전체 저장'을 누르면 한 번에 DB에 반영됩니다.\n또는 각 행의 '저장'으로 개별 저장할 수 있습니다.`);
    }catch(err){
      console.error(err);
      alert('엑셀 미리보기 불러오기에 실패했습니다.');
    }
  }
  function onExcelPreviewPick(e){
    const f=e.target.files?.[0];
    if(!f) return;
    previewExcelFile(f);
    e.target.value='';
  }

  // 메뉴 이미지 업로드/삭제
  async function uploadImage(){
    if(!img) { alert('파일을 선택하세요'); return; }
    try{
      const fd=new FormData();
      fd.append('image', img);
      await api.post('/admin/menu-images', fd, { headers:{ 'Content-Type':'multipart/form-data' } });
      setImg(null);
      await load();
      alert('업로드 완료');
    }catch(e){
      console.error(e);
      alert('업로드 실패');
    }
  }
  async function deleteImage(id){
    await api.delete('/admin/menu-images/'+id);
    await load();
  }

  // 학생 CRUD (단건 추가/수정은 upsert 성격)
  async function addStudent(){
    const payload = {
      name: (newStu.name||'').trim(),
      code: (newStu.code||'').trim(),
      phone: (newStu.phone||'').trim(),
      parent_phone: (newStu.parent_phone||'').trim(),
    };
    if(!payload.name||!payload.code) return alert('이름/코드 필요');
    try{
      await api.post('/admin/students', payload); // upsert
      setNewStu({name:'',code:'',phone:'',parent_phone:''});
      await load();
    }catch(e){
      console.error(e);
      alert('학생 추가에 실패했습니다.\n'+(e?.response?.data?.error||e.message||''));
    }
  }
  async function updateStudent(row){
    const payload = {
      name: (row.name||'').trim(),
      code: (row.code||'').trim(),
      phone: (row.phone||'').trim(),
      parent_phone: (row.parent_phone||'').trim(),
    };
    try{
      if(String(row.id || '').startsWith('tmp-')){
        await api.post('/admin/students', payload); // upsert
      } else {
        await api.put('/admin/students/'+row.id, payload);
      }
      await load();
      alert('저장되었습니다.');
    }catch(e){
      console.error(e);
      alert('저장에 실패했습니다.\n'+(e?.response?.data?.error||e.message||'')); 
    }
  }
  async function deleteStudentRow(id){
    if(!confirm('삭제하시겠습니까?')) return;
    if(String(id || '').startsWith('tmp-')){
      setStudents(list=> list.filter(s=>s.id!==id));
      return;
    }
    await api.delete('/admin/students/'+id);
    await load();
  }

  // ✅ 전체 저장 (현재 테이블의 모든 학생을 일괄 업서트)
  async function bulkSave(){
    if (!students?.length) { alert('저장할 학생이 없습니다.'); return; }
    try{
      setSaving(true);
      const studentsPayload = students
        .map(s=>({
          name: String(s.name||'').trim(),
          code: String(s.code||'').trim(),
          phone: String(s.phone||'').trim(),
          parent_phone: String(s.parent_phone||'').trim(),
        }))
        .filter(x=>x.name && x.code);

      const resp = await api.post('/admin/students/bulk-upsert', { students: studentsPayload });
      const data = resp?.data || {};
      await load();
      alert(`전체 저장 완료\n신규 ${data?.inserted ?? 0}건, 수정 ${data?.updated ?? 0}건`);
    }catch(e){
      console.error(e?.response?.data || e);
      const detail = e?.response?.data?.error || e?.response?.data || e.message || 'Unknown error';
      alert('전체 저장에 실패했습니다.\n' + String(detail));
    } finally {
      setSaving(false);
    }
  }

  async function exportStudents(){
    window.location.href = '/api/admin/students/export';
  }

  // ---- EXCEL Export ----
  async function exportStudentsXlsx(){
    try{
      const res = await studentAPI.exportExcel();
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'students.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    }catch(err){
      console.error(err);
      alert('엑셀 다운로드에 실패했습니다.');
    }
  }

  // 학생별 예외 저장
  async function saveOverride(row){
    const payload={
      allowed_weekdays: (row.allowed_weekdays||'') || null,
      start_date: (row.start_date||'') || null,
      end_date: (row.end_date||'') || null,
      price_override: (row.price_override==='' ? null : (row.price_override ?? null))
    };
    await api.post('/admin/student-policy/'+row.id, payload);
    alert('학생 예외 저장 완료');
    await load();
  }

  // 블랙아웃 추가/삭제
  async function addNoSvc(){
    if(!boDate) return alert('날짜');
    await api.post('/admin/no-service-days',{date:boDate,slot:boSlot});
    setBoDate(''); setBoSlot('BOTH');
    await load();
  }
  async function delNoSvc(id){
    await api.delete('/admin/no-service-days/'+id);
    await load();
  }

  // CSV Import(유지)
  async function importCSV(text){
    await api.post('/admin/students/import',text,{headers:{'Content-Type':'text/csv'}});
    await load();
    alert('CSV 불러오기 완료');
  }
  const onCSV=e=>{
    const f=e.target.files?.[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>importCSV(r.result);
    r.readAsText(f,'utf-8');
    e.target.value='';
  };

  function onCellChange(id,key,val){
    setStudents(list=> list.map(s=> s.id===id ? {...s,[key]:val} : s));
  }

  // --- 주간 요약 ---
  async function loadWeekly(){
    if(!weekStart||!weekEnd) { alert('시작일과 종료일을 선택하세요'); return; }
    const r = await api.get('/admin/weekly-summary', { params:{ start: weekStart, end: weekEnd } });
    setWeekly(r.data);
  }
  const wd = (d)=> DAY_LABELS[new Date(d).getDay()];

  // --- 인쇄: 날짜 받고 새 창으로 열기 (/admin/print?date=YYYY-MM-DD) ---
  function openPrintDialog() {
    const d = prompt('인쇄할 날짜를 YYYY-MM-DD 형식으로 입력하세요.');
    if (!d) return;
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!ok) { alert('형식이 올바르지 않습니다. 예) 2025-09-01'); return; }
    window.open(`/admin/print?date=${encodeURIComponent(d)}`, '_blank');
  }

  // -------------------
  // 🔶 신청자 결제 체크 로직 (기간) — 학생 단일 체크 + 금액
  // -------------------
  async function loadApplicantsRange(){
    if(!appStart || !appEnd) { alert('시작일과 종료일을 선택하세요.'); return; }
    setAppsLoading(true);
    try{
      const { data } = await api.get('/admin/applicants-range', { params: { start: appStart, end: appEnd } });

      // 백엔드 신규 스키마 대응 + 구버전 호환(점/저 필드가 온 경우 유추)
      const rows = (Array.isArray(data) ? data : []).map(r => {
        if (typeof r.applied_count === 'number') {
          // 신규 스키마
          return {
            id: r.id, name: r.name, code: r.code,
            applied_count: Number(r.applied_count || 0),
            paid_count: Number(r.paid_count || 0),
            total_amount: Number(r.total_amount || 0),
            paid: !!r.paid
          };
        } else {
          // 구버전(점/저) → 단일 스키마로 변환
          const lunchApplied = Number(r?.lunch_applied || 0) > 0;
          const dinnerApplied = Number(r?.dinner_applied || 0) > 0;
          const lunchPaidCnt = Number(r?.lunch_paid_cnt || 0);
          const dinnerPaidCnt = Number(r?.dinner_paid_cnt || 0);
          const appliedCnt = (lunchApplied?1:0) + (dinnerApplied?1:0);
          const paidCnt = lunchPaidCnt + dinnerPaidCnt;
          const base = Number(policy?.base_price || 0);
          return {
            id: r.id, name: r.name, code: r.code,
            applied_count: appliedCnt,
            paid_count: paidCnt,
            total_amount: appliedCnt * base,
            paid: appliedCnt>0 && paidCnt === appliedCnt
          };
        }
      });

      setAppRows(rows);
      setAppsDirty(false);
      if (!rows.length) alert('해당 기간에 신청자가 없습니다.');
    }catch(e){
      console.error(e);
      alert('신청자 목록을 불러오지 못했습니다.');
    }finally{
      setAppsLoading(false);
    }
  }

  // 학생 단일 결제 토글
  function setPaid(rowIndex, val){
    setAppRows(list => list.map((r,i) => i===rowIndex ? { ...r, paid: !!val } : r));
    setAppsDirty(true);
  }

  // 전체 토글
  function bulkToggleAll(value){
    setAppRows(list => list.map(r => r.applied_count>0 ? ({ ...r, paid: !!value }) : r));
    setAppsDirty(true);
  }

  // 저장
  async function saveApplicantsPaid(){
    if (!appRows.length) return;
    try{
      // 학생 단위로 {code, paid} 전송
      const items = appRows
        .filter(r => r.applied_count > 0)
        .map(r => ({ code: r.code, paid: !!r.paid }));

      await api.post('/admin/payments/mark-range', { start: appStart, end: appEnd, items });

      setAppsDirty(false);
      alert('변경사항을 저장했습니다.');
      await loadApplicantsRange(); // 저장 후 새로고침
    }catch(e){
      console.error(e);
      alert('저장에 실패했습니다.\n' + (e?.response?.data?.error || e.message || 'Unknown error'));
    }
  }

  // 파생: 미결제 학생
  const unpaidRows = useMemo(
    () => appRows.filter(r => r.applied_count > 0 && !r.paid),
    [appRows]
  );

  // ===== 렌더링 =====
  if (isAuthed === null) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <div className="text-slate-600">관리자 인증 확인 중…</div>
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="min-h-[60vh] grid place-items-center px-4">
        <form onSubmit={handleLogin} className="w-full max-w-sm card p-6 space-y-4">
          <h1 className="text-xl font-bold text-center">관리자 로그인</h1>
          <label className="block text-sm">
            아이디
            <input className="mt-1 input w-full"
              value={loginForm.username}
              onChange={e=>setLoginForm(f=>({...f, username:e.target.value}))}
              autoFocus
            />
          </label>
          <label className="block text-sm">
            비밀번호
            <input className="mt-1 input w-full" type="password"
              value={loginForm.password}
              onChange={e=>setLoginForm(f=>({...f, password:e.target.value}))}
            />
          </label>
          {loginError && <div className="text-danger text-sm">{loginError}</div>}
          <button type="submit" className="btn-primary w-full">로그인</button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 상단 바 */}
      <div className="flex flex-wrap items-center gap-3 card p-4">
        <button className="btn-ghost" onClick={() => setShowStudents((s) => !s)}>학생 DB</button>

        {/* 🔄 인쇄: 날짜 입력 후 새 창 오픈 */}
        <button className="btn-ghost" onClick={openPrintDialog} title="날짜 입력 후 인쇄 화면 열기">
          <Printer size={16} /> 인쇄
        </button>
        <div className="grow" />
        <button className="btn-ghost" onClick={handleLogout} title="로그아웃">
          <LogOut size={16} /> 로그아웃
        </button>
      </div>

      {/* 🟦 신청자 결제 체크 (기간) */}
      <div className="card p-5">
        <h2 className="font-bold text-lg">신청자 결제 체크</h2>
        <div className="mt-2 flex flex-wrap gap-2 items-end">
          <label className="text-sm">시작일
            <input type="date" className="mt-1 input" value={appStart} onChange={e=>setAppStart(e.target.value)} />
          </label>
          <div className="pb-2">~</div>
          <label className="text-sm">종료일
            <input type="date" className="mt-1 input" value={appEnd} onChange={e=>setAppEnd(e.target.value)} />
          </label>
          <button className="btn" onClick={loadApplicantsRange} disabled={appsLoading}>
            {appsLoading ? '불러오는 중…' : '신청자 불러오기'}
          </button>

          <div className="grow" />
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={()=>bulkToggleAll(true)} title="전체 결제 처리"><CheckSquare size={16}/> 전체 결제</button>
            <button className="btn-ghost" onClick={()=>bulkToggleAll(false)} title="전체 결제 해제"><Square size={16}/> 전체 해제</button>
            <button className="btn-primary" disabled={!appsDirty || !appRows.length} onClick={saveApplicantsPaid}>
              변경사항 저장
            </button>
          </div>
        </div>

        <div className="mt-3 overflow-auto">
          <table className="min-w-[720px] w-full text-sm border">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-2 border text-left">이름</th>
                <th className="p-2 border text-left">코드</th>
                <th className="p-2 border text-center">신청식수</th>
                <th className="p-2 border text-center">결제식수</th>
                <th className="p-2 border text-right">결제금액</th>
                <th className="p-2 border text-center">결제됨</th>
              </tr>
            </thead>
            <tbody>
              {appRows.map((r, idx) => (
                <tr key={r.code} className="hover:bg-slate-50">
                  <td className="p-2 border">{r.name}</td>
                  <td className="p-2 border">{r.code}</td>
                  <td className="p-2 border text-center">{r.applied_count ?? 0}</td>
                  <td className="p-2 border text-center">{r.paid_count ?? 0}</td>
                  <td className="p-2 border text-right">{Number(r.total_amount||0).toLocaleString()}원</td>
                  <td className="p-2 border text-center">
                    {r.applied_count>0 ? (
                      <input type="checkbox" checked={!!r.paid} onChange={e=>setPaid(idx, e.target.checked)} />
                    ) : <span className="text-slate-400">-</span>}
                  </td>
                </tr>
              ))}
              {appRows.length===0 && (
                <tr><td className="p-4 border text-center text-slate-500" colSpan={6}>신청자가 없습니다. 기간을 선택하고 불러오기를 눌러주세요.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-slate-500 mt-2">
          * 체크하면 해당 학생의 <b>기간 내 모든 신청(점심/저녁)</b>이 결제 완료 처리됩니다.
        </div>

        {/* 미결제 학생 목록 */}
        <div className="mt-6">
          <h3 className="font-semibold mb-2">미결제 학생</h3>
          <div className="overflow-auto">
            <table className="min-w-[520px] w-full text-sm border">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-2 border text-left">이름</th>
                  <th className="p-2 border text-left">코드</th>
                  <th className="p-2 border text-center">신청식수</th>
                  <th className="p-2 border text-right">결제 필요 금액</th>
                </tr>
              </thead>
              <tbody>
                {unpaidRows.map(r=>(
                  <tr key={r.code}>
                    <td className="p-2 border">{r.name}</td>
                    <td className="p-2 border">{r.code}</td>
                    <td className="p-2 border text-center">{r.applied_count ?? 0}</td>
                    <td className="p-2 border text-right">
                      {Number(r.total_amount || 0).toLocaleString()}원
                    </td>
                  </tr>
                ))}
                {unpaidRows.length===0 && (
                  <tr><td colSpan={4} className="p-4 text-center text-slate-500">모든 신청이 결제되었습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 학생 DB */}
      {showStudents && (
        <div className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold text-lg">학생 DB</h2>
            {/* ✅ 전체 저장 */}
            <button className="btn flex items-center gap-2" onClick={bulkSave} disabled={saving} title="현재 목록을 한 번에 DB에 반영">
              <Save size={16}/> {saving ? '저장 중…' : '전체 저장'}
            </button>
          </div>

          {/* 업로드/다운로드 + 학생 추가 */}
          <div className="
            mt-3 grid gap-2 items-end
            sm:grid-cols-2
            md:grid-cols-[1fr_1fr_1fr_1fr_auto]
          ">
            <input className="input" placeholder="이름" value={newStu.name} onChange={e=>setNewStu(s=>({...s,name:e.target.value}))}/>
            <input className="input" placeholder="코드" value={newStu.code} onChange={e=>setNewStu(s=>({...s,code:e.target.value}))}/>
            <input className="input" placeholder="학생 연락처" value={newStu.phone} onChange={e=>setNewStu(s=>({...s,phone:e.target.value}))}/>
            <input className="input" placeholder="학부모 연락처" value={newStu.parent_phone} onChange={e=>setNewStu(s=>({...s,parent_phone:e.target.value}))}/>
            <button className="btn" onClick={addStudent}>학생 추가</button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <button className="btn-ghost" onClick={exportStudentsXlsx}>다운로드(엑셀)</button>
            <label className="btn-ghost">
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onExcelPreviewPick}/>
              불러오기(엑셀, 미리보기)
            </label>

            <button className="btn-ghost" onClick={exportStudents}>다운로드(CSV)</button>
            <label className="btn-ghost">
              <input type="file" accept=".csv" className="hidden" onChange={onCSV}/>
              불러오기(CSV)
            </label>

            <div className="grow" />
            <input className="input w-full sm:w-80" placeholder="이름 또는 코드 검색" value={search} onChange={e=>setSearch(e.target.value)} />
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm border">
              <thead className="bg-slate-50"><tr>
                <th className="p-2 border">이름</th>
                <th className="p-2 border">코드</th>
                <th className="p-2 border">학생 연락처</th>
                <th className="p-2 border">학부모 연락처</th>
                <th className="p-2 border">액션</th>
              </tr></thead>
              <tbody>
                {filtered.map(st=>(
                  <tr key={st.id}>
                    <td className="p-2 border"><input className="input" value={st.name||''} onChange={e=>onCellChange(st.id,'name',e.target.value)}/></td>
                    <td className="p-2 border"><input className="input" value={st.code||''} onChange={e=>onCellChange(st.id,'code',e.target.value)}/></td>
                    <td className="p-2 border"><input className="input" value={st.phone||''} onChange={e=>onCellChange(st.id,'phone',e.target.value)}/></td>
                    <td className="p-2 border"><input className="input" value={st.parent_phone||''} onChange={e=>onCellChange(st.id,'parent_phone',e.target.value)}/></td>
                    <td className="p-2 border">
                      <div className="flex gap-2">
                        <button className="btn-ghost" onClick={()=>updateStudent(st)}>저장</button>
                        <button className="btn-ghost" onClick={()=>deleteStudentRow(st.id)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length===0 && (
                  <tr><td colSpan={5} className="p-4 text-center text-slate-500">학생이 없습니다. 엑셀 미리보기로 불러오거나 상단에서 추가하세요.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="card p-5"><div className="text-slate-500 text-sm">등록 학생</div><div className="text-3xl font-bold mt-1">{kpi.students}명</div></div>
        <div className="card p-5"><div className="text-slate-500 text-sm">기본 1식 가격</div><div className="text-3xl font-bold mt-1">{kpi.price.toLocaleString()}원</div></div>
        <div className="card p-5"><div className="text-slate-500 text-sm">도시락 미제공 지정 수</div><div className="text-3xl font-bold mt-1">{kpi.nosvc}</div></div>
      </div>

      {policy && (
        <div className="card p-5">
          <h2 className="font-bold text-lg flex items-center gap-2"><Settings size={18}/> 전역 정책</h2>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <label className="text-sm">기본 가격(원)
              <input type="number" value={policy.base_price} onChange={e=>setPolicy({...policy,base_price:+e.target.value})} className="mt-1 w-full border rounded-xl px-3 py-2"/>
            </label>
            <div className="text-sm">허용 요일(복수 선택)
              <div className="mt-1 grid grid-cols-7 gap-1">
                {DAY_LABELS.map((lb,i)=>(
                  <label key={lb} className={"px-2 py-1 rounded-lg border text-center cursor-pointer "+(((policy.allowed_weekdays||'').split(',').includes(DAY_CODES[i]))?'bg-primary text-white border-primary':'bg-white')}>
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={(policy.allowed_weekdays||'').split(',').includes(DAY_CODES[i])}
                      onChange={()=>{
                        const set=new Set((policy.allowed_weekdays||'').split(',').filter(Boolean));
                        if(set.has(DAY_CODES[i])) set.delete(DAY_CODES[i]); else set.add(DAY_CODES[i]);
                        const ordered = DAY_CODES.filter(c=>set.has(c)).join(',');
                        setPolicy(p=>({...p, allowed_weekdays: ordered}));
                      }}
                    />{lb}
                  </label>
                ))}
              </div>
            </div>
            <label className="text-sm">시작일
              <input value={policy.start_date||''} onChange={e=>setPolicy(p=>({ ...p, start_date: e.target.value }))} placeholder="YYYY-MM-DD" className="mt-1 w-full border rounded-xl px-3 py-2"/>
            </label>
            <label className="text_sm">종료일
              <input type="date" value={policy.end_date||""} onChange={e=>setPolicy(p=>({...p,end_date:e.target.value}))} className="mt-1 w-full border rounded-xl px-3 py-2"/>
            </label>

            <label className="text-sm sm:col-span-2">
              문자 추가 메모(고정 문구)
              <textarea
                rows={3}
                className="mt-1 w-full border rounded-xl px-3 py-2"
                placeholder="예) 도시락 수령은 스터디룸 입구에서 해주세요 🙂"
                value={policy.sms_extra_text || ''}
                onChange={e=>setPolicy(p=>({...p, sms_extra_text: e.target.value}))}
              />
              <div className="text-xs text-slate-500 mt-1">
                학생이 ‘신청 내역 문자 받기’를 누를 때, 본문 하단에 이 문구가 자동으로 붙습니다.
              </div>
            </label>
          </div>
          <button className="btn-primary mt-3" onClick={async ()=>{
            const payload={...policy};
            await api.post('/admin/policy',payload);
            alert('정책 저장 완료');
          }}>저장</button>
        </div>
      )}

      <div className="card p-5">
        <h2 className="font-bold text-lg">메뉴 이미지 업로드</h2>
        <div className="flex gap-2 mt-2">
          <input type="file" accept="image/*" onChange={e=>setImg(e.target.files?.[0]||null)} />
          <button className="btn-ghost" type="button" onClick={uploadImage}>업로드</button>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 mt-3">
          {images.map(x=>(
            <div key={x.id} className="border rounded-xl p-2 text-center">
              <img src={x.url} className="w-full h-28 object-cover rounded-lg"/>
              <button className="mt-2 btn-ghost mx-auto" onClick={()=>deleteImage(x.id)}><Trash2 size={16}/> 취소(삭제)</button>
            </div>
          ))}
          {images.length===0 && <div className="text-slate-500">업로드된 이미지가 없습니다.</div>}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-bold text-lg flex items-center gap-2"><CalendarDays size={18}/> 도시락 미제공일 지정</h2>
        <div className="flex flex-wrap gap-2 mt-2">
          <input type="date" value={boDate} onChange={e=>setBoDate(e.target.value)} className="border rounded-xl px-3 py-2"/>
          <select value={boSlot} onChange={e=>setBoSlot(e.target.value)} className="border rounded-xl px-3 py-2">
            <option value="BOTH">점심+저녁</option>
            <option value="LUNCH">점심</option>
            <option value="DINNER">저녁</option>
          </select>
          <button className="btn-ghost" onClick={addNoSvc}>추가</button>
        </div>
        <table className="w-full text-sm border mt-3">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr><th className="p-2 border">ID</th><th className="p-2 border">날짜</th><th className="p-2 border">구분</th><th className="p-2 border text-center">삭제</th></tr>
          </thead>
          <tbody>
            {nosvc.map(b=>(
              <tr key={b.id}>
                <td className="p-2 border">{b.id}</td>
                <td className="p-2 border">{b.date}</td>
                <td className="p-2 border">{b.slot}</td>
                <td className="p-2 border text-center"><button className="text-danger" onClick={()=>delNoSvc(b.id)}>삭제</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <h2 className="font-bold text-lg">주간 신청 요약</h2>
        <div className="mt-3 grid sm:grid-cols-[1fr_auto_1fr] gap-2 items-end">
          <label className="text-sm">시작일
            <input type="date" value={weekStart} onChange={e=>setWeekStart(e.target.value)} className="mt-1 w-full border rounded-xl px-3 py-2"/>
          </label>
          <div className="flex items-end"><span className="px-2">~</span></div>
          <label className="text-sm">종료일
            <input type="date" value={weekEnd} onChange={e=>setWeekEnd(e.target.value)} className="mt-1 w-full border rounded-xl px-3 py-2"/>
          </label>
        </div>
        <div className="mt-2">
          <button className="btn-primary" onClick={loadWeekly}>요약 불러오기</button>
        </div>

        {weekly && Array.isArray(weekly.days) && Array.isArray(weekly.rows) ? (
          <div className="mt-4 overflow-auto">
            <table className="min-w-[900px] w-full text-sm border">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-2 border text-left">이름 (코드)</th>
                  {weekly.days.map(d=>(
                    <th key={d} className="p-2 border text-center">{d} <span className="text-slate-500 text-xs">({wd(d)})</span></th>
                  ))}
                  <th className="p-2 border text-right">합계</th>
                </tr>
              </thead>
              <tbody>
                {weekly.rows.map(r=>{
                  const total = r.count ?? 0;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="p-2 border">{r.name} <span className="text-slate-500">({r.code})</span></td>
                      {weekly.days.map(d=>{
                        const info = r.byDate?.[d] || {};
                        const marks = [
                          info.LUNCH ? '점' : '',
                          info.DINNER ? '저' : ''
                        ].filter(Boolean).join('·');
                        return <td key={d} className="p-2 border text-center">{marks}</td>;
                      })}
                      <td className="p-2 border text-right">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
