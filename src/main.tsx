import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getLanguage } from "./i18n";

document.documentElement.lang = getLanguage();
import "./styles.css";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
      console.warn("オフライン機能を有効にできませんでした。", error);
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
