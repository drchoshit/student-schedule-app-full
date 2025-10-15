  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';

  import Student from './pages/Student.jsx';
  import Admin from './pages/Admin.jsx';
  import Print from './pages/Print.jsx';
  import Success from './pages/PaymentSuccess.jsx';
  import Fail from './pages/PaymentFail.jsx';
  import Orders from './pages/Orders.jsx'; // 신청 리스트 페이지
  import './styles.css';

  function Frame({ children }) {
    const loc = useLocation();
    // 관리자 영역에서만 상단 우측 네비 표시
    const showAdminNav = loc.pathname.startsWith('/admin');

    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur shadow">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link to="/" className="font-bold text-primary text-lg">
              메디컬로드맵 주간 도시락 신청페이지
            </Link>

            {showAdminNav && (
              <nav className="flex items-center gap-4">
                <Link to="/admin" className="hover:underline">관리자</Link>
                <Link to="/admin/orders" className="hover:underline">신청 리스트</Link>
              </nav>
            )}
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
      </div>
    );
  }

  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Frame><Student /></Frame>} />
          <Route path="/admin" element={<Frame><Admin /></Frame>} />
          <Route path="/admin/orders" element={<Frame><Orders /></Frame>} />
          <Route path="/admin/print" element={<Frame><Print /></Frame>} />
          <Route path="/payment/success" element={<Frame><Success /></Frame>} />
          <Route path="/payment/fail" element={<Frame><Fail /></Frame>} />
        </Routes>
      </BrowserRouter>
    </React.StrictMode>
  );
