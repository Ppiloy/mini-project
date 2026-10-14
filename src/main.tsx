import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/500.css";
import "@fontsource/noto-sans-thai/600.css";
import "./style.css";

function App() {
  return (
    <main className="shell">
      <p className="notice">ระบบต้นแบบเพื่อการศึกษา</p>
      <h1>เครดิตภาษีเงินได้จากต่างประเทศ</h1>
      <p>พื้นที่สาธิตกำลังเตรียมข้อมูลตัวอย่าง</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
