import { createRoot } from "react-dom/client";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/500.css";
import "@fontsource/noto-sans-thai/600.css";
import "./style.css";
import { App } from "./app/App.js";

createRoot(document.getElementById("root")!).render(
  <App />
);
