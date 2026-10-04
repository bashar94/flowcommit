import { useEffect, useLayoutEffect, useState } from "react";

/** A few tips the first time someone has a flow in front of them, each pointing at what it explains. */
const TIPS = [
  {
    target: ".react-flow__pane",
    title: "This is your app, as a flowchart",
    text: "Each card is a step. Drag cards to move them, click one to edit it, and press Tab to add the next step. The shape tells you the type: diamonds are decisions, wide cards are screens.",
  },
  {
    target: ".dock",
    title: "Add steps from here",
    text: "Click a type to add it after the selected step, or drag it onto the canvas. Drag from the dot under a card to draw an arrow.",
  },
  {
    target: ".inspector",
    title: "Tell the AI what to build",
    text: "The instructions you write for each step are what the AI builds from. Attach mockups and mark them up to point at exactly what you mean.",
  },
  {
    target: "[data-tip='build']",
    title: "Let AI build it",
    text: "Connect Claude Code or Codex and they build your app one step at a time. Cards light up as they go, and anything they add to the code comes back here as a suggestion.",
  },
  {
    target: "[data-tip='save']",
    title: "Save versions as you go",
    text: "Every version is kept in Git with what changed, so you can compare, go back, or try ideas on a branch.",
  },
] as const;

const KEY = "flowcommit.tips-seen";

export function tipsSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true; // without storage the tips would come back on every visit
  }
}

export function FirstRunTips({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tip = TIPS[index];

  useLayoutEffect(() => {
    const place = () => setRect(document.querySelector(tip.target)?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [tip.target]);

  const finish = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // Then they may show again next time.
    }
    onDone();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const last = index === TIPS.length - 1;
  const place = tipPosition(rect);

  return (
    <>
      {rect && (
        <div
          className="tip-highlight"
          aria-hidden="true"
          style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}
      <div className="tip-card" role="dialog" aria-labelledby="tip-title" style={place}>
        <p className="tip-count">
          Tip {index + 1} of {TIPS.length}
        </p>
        <h2 id="tip-title" className="tip-title">
          {tip.title}
        </h2>
        <p className="tip-text">{tip.text}</p>
        <div className="confirm-actions">
          <button type="button" className="button-primary" autoFocus onClick={() => (last ? finish() : setIndex(index + 1))}>
            {last ? "Start designing" : "Next"}
          </button>
          {!last && (
            <button type="button" className="button-quiet" onClick={finish}>
              Skip the tips
            </button>
          )}
        </div>
      </div>
    </>
  );
}

const CARD_W = 320;

/** Next to the target: below small things like buttons, inside big areas like the canvas. */
function tipPosition(rect: DOMRect | null): React.CSSProperties {
  if (!rect) return { left: "50%", top: "40%", transform: "translate(-50%, -50%)" };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(16, Math.min(x, vw - CARD_W - 16));
  if (rect.width > vw * 0.5 && rect.height > vh * 0.5) return { left: clampX(rect.left + 32), top: rect.top + 32 };
  if (rect.top > vh * 0.6) return { left: clampX(rect.left + rect.width / 2 - CARD_W / 2), bottom: vh - rect.top + 14 };
  if (rect.left > vw * 0.6) return { left: clampX(rect.left - CARD_W - 16), top: Math.max(16, rect.top + 24) };
  return { left: clampX(rect.right - CARD_W), top: rect.bottom + 14 };
}
