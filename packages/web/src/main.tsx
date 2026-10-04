import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { App } from "./App.tsx";
import { AiProvider } from "./ai.tsx";
import { ToastProvider } from "./components/Toasts.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AiProvider>
      <ToastProvider>
        <ReactFlowProvider>
          <App />
        </ReactFlowProvider>
      </ToastProvider>
    </AiProvider>
  </StrictMode>,
);
