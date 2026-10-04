import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Icon } from "../icons.tsx";

type Toast = { id: number; text: string; tone: "info" | "error"; action?: { label: string; run: () => void } };
type Notify = (text: string, opts?: { tone?: Toast["tone"]; action?: Toast["action"]; sticky?: boolean }) => void;

const ToastContext = createContext<Notify>(() => {});
const VISIBLE_MS = 4500;

/** Short messages that confirm an action, shown at the top of the screen. Most close on their own. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const notify: Notify = useCallback(
    (text, opts = {}) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts.slice(-2), { id, text, tone: opts.tone ?? "info", action: opts.action }]);
      // Sticky messages need a decision, so they stay until the person acts on them.
      if (!opts.sticky) setTimeout(() => dismiss(id), opts.action ? VISIBLE_MS * 2 : VISIBLE_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" data-tone={t.tone}>
            <Icon name={t.tone === "error" ? "close" : "check"} />
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
