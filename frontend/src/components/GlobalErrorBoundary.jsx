import React from "react";

export default class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, msg: "" };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, msg: err?.message || "알 수 없는 오류" };
  }
  componentDidCatch(err, info) {
    // 필요하면 서버로 로깅
    // console.error("Boundary", err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <h2>문제가 발생했어요 😥</h2>
          <p style={{ color: "#666" }}>{this.state.msg}</p>
          <button onClick={() => (window.location.href = "/admin/login")}>
            관리자 로그인으로 이동
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
