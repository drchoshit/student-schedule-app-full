import React, { useMemo, useState, useEffect } from 'react';
import api from "../lib/api";

const weekdaysKo = ['일','월','화','수','목','금','토'];
const slots = ['LUNCH','DINNER'];
const slotKo = { LUNCH:'점심', DINNER:'저녁' };

const LS_KEY = 'doshirak.session.v1';

function ymd(dt){ const p=n=>String(n).padStart(2,'0'); return `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())}`; }
function fmtMD(dateStr){ const d=new Date(dateStr); if (isNaN(d)) return dateStr; return `${d.getMonth()+1}/${d.getDate()}`; }
function genDates(startStr, endStr){
  const out=[]; const s=new Date(startStr), e=new Date(endStr);
  if(isNaN(s) || isNaN(e)) return out;
  let cur=new Date(s); while(cur<=e){ out.push(ymd(cur)); cur.setDate(cur.getDate()+1); }
  return out;
}
function readLS(){
  try{ return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }catch{ return {}; }
}
function writeLS(obj){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(obj||{})); }catch{}
}

export default function Student(){
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [policy, setPolicy] = useState(null);
  const [weekDates, setWeekDates] = useState([]);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  // 코드별 임시 선택 저장용
  const [selected, setSelected] = useState({});
  const [phone, setPhone] = useState('01022223333');
  const [smsPreview, setSmsPreview] = useState(null);
  const [smsSent, setSmsSent] = useState(true);
  const [showSmsRequire, setShowSmsRequire] = useState(false);
  const [lsReady, setLsReady] = useState(false); // 초기 복구 완료 플래그

  // 허용 요일: 비어 있으면 월~금 기본 허용
  const allowed = useMemo(()=>{
    const arr = Array.isArray(policy?.allowed_weekdays) ? policy.allowed_weekdays : [];
    return new Set(arr.length ? arr : ['MON','TUE','WED','THU','FRI']);
  },[policy]);

  // 미제공일(블랙아웃) 맵
  const nosvc = useMemo(()=>{
    const m=new Map();
    (policy?.no_service_days||[]).forEach(b=>m.set(`${b.date}-${b.slot}`,true));
    return m;
  },[policy]);

  const price = policy?.base_price || 0;

  // 기간 → 날짜 배열
  useEffect(()=>{
    if(rangeStart && rangeEnd) setWeekDates(genDates(rangeStart, rangeEnd));
    else setWeekDates([]);
  },[rangeStart, rangeEnd]);

  // 1) 로컬스토리지에서 복구 + 자동 입장
  useEffect(()=>{
    const saved = readLS();
    if(saved.lastCode){
      setCode(saved.lastCode || '');
      setName(saved.lastName || '');
      setPhone(saved.phone || '01022223333');
      // 먼저 선택 복구
      const sel = (saved.selections && saved.selections[saved.lastCode]) || {};
      setSelected(sel);
      // 정책 자동 로드
      (async ()=>{
        try{
          const res = await api.get('/policy/active', { params:{ code: saved.lastCode } });
          const pol = res.data;
          setPolicy(pol);
          const s = pol.start_date || ymd(new Date());
          const e = pol.end_date   || s;
          setRangeStart(s); setRangeEnd(e);
        }catch(e){
          // 자동 복구 실패해도 저장 데이터는 지우지 않음
          setPolicy(null); setRangeStart(''); setRangeEnd(''); setWeekDates([]);
        }finally{
          setLsReady(true);
        }
      })();
    }else{
      setLsReady(true);
    }
  },[]);

  // 2) 코드가 바뀌면 해당 코드의 선택을 복원
  useEffect(()=>{
    if(!lsReady) return;
    const saved = readLS();
    const sel = (saved.selections && saved.selections[code]) || {};
    setSelected(sel);
  },[code, lsReady]);

  // 3) 입력/선택이 바뀔 때마다 로컬스토리지 동기화
  useEffect(()=>{
    if(!lsReady) return;
    const saved = readLS();
    const selections = saved.selections || {};
    if(code){ selections[code] = selected; } // 코드가 비어있으면 덮어쓰지 않음
    writeLS({ lastCode: code, lastName: name, phone, selections });
  },[code, name, phone, selected, lsReady]);

  async function enter(){
    if(!code || !name) return alert('코드와 이름을 모두 입력하세요');
    try{
      const res = await api.get('/policy/active', { params:{ code } });
      const pol = res.data;
      setPolicy(pol);
      const s = pol.start_date || ymd(new Date());
      const e = pol.end_date   || s;
      setRangeStart(s); setRangeEnd(e);
    }catch(err){
      const status = err?.response?.status;
      if(status === 404) alert('해당 코드의 학생을 찾을 수 없습니다. 관리자에게 학생 등록 여부를 확인해 주세요.');
      else alert('신청 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setPolicy(null); setRangeStart(''); setRangeEnd(''); setWeekDates([]);
    }
  }

  function toggle(date, slot){
    const key = `${date}-${slot}`;
    setSelected(s => ({ ...s, [key]: !s[key] }));
  }
  function removeItem(it){
    const key = `${it.date}-${it.slot}`;
    setSelected(s => ({ ...s, [key]: false }));
  }

  const items = Object.entries(selected)
    .filter(([k,v])=>v)
    .map(([k])=>{
      const lastDash = k.lastIndexOf('-');
      const d = k.slice(0, lastDash);
      const slot = k.slice(lastDash + 1);
      return { date: d, slot, price };
    });
  const total = items.reduce((a,b)=>a+b.price,0);

  async function commit(){
    if(!code) return alert('코드를 먼저 입력하세요.');
    if(items.length===0) return alert('선택이 없습니다.');
    // 문자 확인 가드 제거: smsSent 여부와 모달 호출을 더 이상 체크하지 않습니다.
    try{
      await api.post('/orders/commit',{ code, items });
      alert('도시락 신청 완료(결재 전)');
    }catch{
      alert('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }

  // 문자 전송(미리보기 포함)
  async function sms(){
    if(items.length===0) { alert('선택이 없습니다'); return; }

    const grouped = items.reduce((acc, it) => { (acc[it.date] = acc[it.date] || []).push(it); return acc; }, {});
    const orderedDates = Object.keys(grouped).sort();
    const periodText = orderedDates.length
      ? (fmtMD(orderedDates[0]) + (orderedDates[0] === orderedDates[orderedDates.length - 1] ? '' : `~${fmtMD(orderedDates[orderedDates.length - 1])}`))
      : '-';
    const totalCount = items.length;
    const lines = orderedDates.map(d => {
      const wd = weekdaysKo[new Date(d).getDay()];
      const labels = grouped[d].map(x=>slotKo[x.slot]).sort().join(', ');
      return `${fmtMD(d)}(${wd}) ${labels}`;
    }).join('\n');

    const studentName = (name || policy?.student?.name || '').trim();
    const memo = (policy?.sms_extra_text || '').trim();
    let previewMsg =
      `[메디컬로드맵 도시락 신청]\n\n` +
      `※ ${studentName}학생\n` +
      `- 기간: ${periodText}\n` +
      `- 식수: ${totalCount}식\n` +
      `- 비용: ${total.toLocaleString()}원`;
    if(memo){ previewMsg += `\n\n※ 입금 계좌\n${memo}`; }
    previewMsg += `\n\n※ 신청내역\n${lines || '-'}`;
    setSmsPreview(previewMsg);
    setSmsSent(true);

    const to = (phone||'').trim();
    if(!to || to.length < 9){ alert('전화번호를 정확히 입력해 주세요.'); return; }
    try{
      await api.post('/sms/summary', { to, code, items, total, name });
      alert('입력하신 번호로 문자가 전송되었습니다.');
    }catch(e){
      console.error('SMS send failed', e?.response?.data||String(e));
      alert('문자 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }

  // 현재 코드의 임시 선택만 초기화
  function resetSelections(){
    setSelected({});
    setSmsSent(true);
    setSmsPreview(null);
    const saved = readLS();
    const selections = saved.selections || {};
    if(code) selections[code] = {};
    writeLS({ lastCode: code, lastName: name, phone, selections });
    alert('선택이 초기화되었습니다.');
  }

  return (
    <div className="grid grid-student lg:grid-cols-2 gap-6">
      {/* Left */}
      <section className="card p-5">
        <h2 className="text-xl font-bold mb-3">학생 입장</h2>
        <div className="flex gap-2 flex-col sm:flex-row">
          <input className="flex-1 border rounded-xl px-3 py-2" placeholder="코드 입력 (예: dfv201)" value={code} onChange={e=>setCode(e.target.value)}/>
          <input className="flex-1 border rounded-xl px-3 py-2" placeholder="이름 입력" value={name} onChange={e=>setName(e.target.value)}/>
          <button className="btn-primary" onClick={enter}>입장</button>
        </div>

        {policy && (
          <div className="mt-4 text-slate-600">
            <b>{policy?.student?.name ?? '학생'}</b> 학생의 페이지
          </div>
        )}

        <h3 className="mt-5 font-semibold">이번 주 메뉴</h3>
        <LargeMenu/>
      </section>

      {/* Middle: week calendar */}
      <section className="card p-5">
        <h2 className="text-xl font-bold mb-3">기간 신청</h2>
        {!policy && <div className="text-slate-500">코드와 이름으로 입장하면 신청 캘린더가 열립니다.</div>}
        {policy && (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-slate-500">선택 후 우측에서 요약 확인</div>
              <button className="btn-ghost" onClick={resetSelections}>선택 리셋</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {weekDates.map(d=>{
                const wd = new Date(d).getDay();
                const wdCode=['SUN','MON','TUE','WED','THU','FRI','SAT'][wd];

                // 카드 숨김: 허용 요일 X, 혹은 점/저녁 모두 막힘
                const allowedDay = allowed.has(wdCode);
                const blockedBoth =
                  nosvc.get(`${d}-BOTH`) ||
                  (nosvc.get(`${d}-LUNCH`) && nosvc.get(`${d}-DINNER`));
                if (!allowedDay || blockedBoth) return null;

                return (
                  <div key={d} className="rounded-2xl border p-4 shadow-sm bg-white">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold">{d}</div>
                      <div className="text-sm text-slate-500">{weekdaysKo[wd]}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-1">
                      {slots.map(slot=>{
                        const key = `${d}-${slot}`;
                        const sel = !!items.find(x=>x.date===d && x.slot===slot);
                        const disabled = !!nosvc.get(key);
                        return (
                          <button
                            key={slot}
                            onClick={()=>!disabled && toggle(d,slot)}
                            className={`h-10 rounded-xl border text-sm w-full text-center transition
                              ${sel ? 'bg-primary text-white border-primary shadow' : 'bg-white hover:bg-slate-50'}
                              ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
                            `}
                            disabled={disabled}
                            title={disabled ? '신청 불가' : slotKo[slot]}
                          >
                            {slotKo[slot]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* Right: summary */}
      <aside className="card p-5 lg:col-span-2 h-max">
        <h2 className="text-xl font-bold mb-3">결제 요약</h2>
        {(() => {
          const groups = items.reduce((acc, it) => {
            (acc[it.date] = acc[it.date] || []).push(it);
            return acc;
          }, {});
          const rows = Object.entries(groups).map(([date, arr]) => {
            const wd = weekdaysKo[new Date(date).getDay()];
            const labels = arr.map(x => slotKo[x.slot]).sort();
            const perDayTotal = arr.reduce((s,x)=> s + (x.price||0), 0);
            return { date, wd, labels, perDayTotal, arr };
          }).sort((a,b)=> a.date.localeCompare(b.date));
          return (
            <>
              <div className="space-y-2 max-h-64 overflow-auto pr-1">
                {items.length===0 && <div className="text-slate-500">선택 내역이 없습니다.</div>}
                {rows.map((r) => (
                  <div key={r.date} className="flex items-center justify-between text-sm">
                    <div>{r.date} {r.wd} {r.labels.join(', ')}</div>
                    <div className="font-semibold">{r.perDayTotal.toLocaleString()}원</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 p-3 bg-slate-50 rounded-xl flex items-center justify-between">
                <div className="text-slate-600">합계</div>
                <div className="text-xl font-bold">{total.toLocaleString()}원</div>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <button className="btn-primary" onClick={commit}>*필수클릭* 저장 및 제출하기</button>

                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="전화번호 입력 (숫자만)"
                    value={phone}
                    onChange={e=>setPhone((e.target.value||'').replace(/[^0-9]/g,''))}
                  />
                  <button className="btn-ghost" onClick={sms}>신청 내역 문자 받기</button>
                </div>

                {smsPreview && (
                  <div className="mt-2 p-3 bg-white border rounded-xl">
                    <div className="text-sm whitespace-pre-wrap">{smsPreview}</div>
                    <div className="mt-2 flex justify-end">
                      <button className="btn-ghost" onClick={()=>setSmsPreview(null)}>닫기</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )
        })()}
      </aside>

      {/* Global modal: 문자 요구 */}
      {showSmsRequire && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-[90vw] max-w-md shadow-xl">
            <div className="text-lg font-semibold mb-2">문자 확인 필요</div>
            <div className="text-sm text-slate-600 mb-4">
              저장이나 결제를 진행하기 전에 먼저 <b>“신청 내역 문자 받기”</b>를 눌러 본인 휴대폰으로 신청 내역을 받아 주세요.
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={()=>{ setShowSmsRequire(false); sms(); }}>문자로 받기</button>
              <button className="btn" onClick={()=>setShowSmsRequire(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LargeMenu(){
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(()=>{ (async()=>{
    const r = await fetch('/api/menu-images'); setList(await r.json());
  })(); },[]);
  if(list.length===0) return <div className="text-slate-500">업로드된 메뉴 이미지가 없습니다.</div>;
  const first = list[0];
  return (
    <>
      <img
        src={first.url}
        onClick={()=>setOpen(true)}
        title="클릭하면 확대"
        className="mt-2 w-full h-72 sm:h-96 object-cover rounded-2xl border cursor-zoom-in"
      />
      {open && (
        <div onClick={()=>setOpen(false)} className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <img src={first.url} className="max-w-[90vw] max-h-[90vh] rounded-2xl"/>
        </div>
      )}
    </>
  );
}
