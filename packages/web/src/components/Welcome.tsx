import { useEffect, useRef, useState } from "react";
import type { DraftFlow, ImportedFlow, TemplateSummary } from "@flowcommit/shared";
import { api } from "../api.ts";
import { useAi } from "../ai.tsx";
import { Icon } from "../icons.tsx";
import { TEMPLATES, type Template } from "../templates.ts";

type Props = {
  initialDescription: string;
  onDraft: (draft: DraftFlow, description: string) => void;
  onImport: (flow: ImportedFlow) => void;
  onTemplate: (t: Template) => void;
  onBlank: () => void;
};

const EXAMPLES = [
  "A recipe app where people save recipes from links and plan meals for the week.",
  "A booking page for a hair salon: pick a service, a stylist and a time, then pay a deposit.",
  "A team standup bot that asks three questions every morning and posts a summary.",
];

/**
 * First thing a new project sees: describe the app and let AI draw the flow, or start from a
 * template. A folder that already has code is offered a flow drawn from that code first.
 */
export function Welcome({ initialDescription, onDraft, onImport, onTemplate, onBlank }: Props) {
  const { active, providers } = useAi();
  const [description, setDescription] = useState(initialDescription);
  // Whether the folder already has code, which decides what the welcome offers first.
  // Unknown until the server answers; nothing is shown before then, so it doesn't flicker.
  const [fromCode, setFromCode] = useState<boolean | null>(null);
  const [running, setRunning] = useState<{ controller: AbortController; startedAt: number; what: "draft" | "import" } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api
      .project()
      .then((p) => setFromCode(p.hasCode))
      .catch(() => setFromCode(false));
  }, []);

  useEffect(() => {
    if (fromCode === false) textRef.current?.focus();
  }, [fromCode]);

  // Templates added by plugins, like your own folder of templates or a marketplace.
  const [more, setMore] = useState<{ source: { id: string; label: string }; templates: TemplateSummary[] }[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    api
      .templates()
      .then((r) => setMore(r.sources.filter((s) => s.templates.length > 0)))
      .catch(() => {});
  }, []);
  const openTemplate = async (sourceId: string, id: string) => {
    setOpening(`${sourceId}/${id}`);
    setError("");
    try {
      const t = await api.template(sourceId, id);
      onTemplate({ id: t.id, title: t.title, blurb: t.blurb, description: t.description, flow: t.flow });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOpening(null);
    }
  };

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - running.startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => () => running?.controller.abort(), [running]);

  const draft = async () => {
    if (!active || !description.trim()) return;
    const controller = new AbortController();
    setError("");
    setElapsed(0);
    setRunning({ controller, startedAt: Date.now(), what: "draft" });
    try {
      const result = await api.aiDraft({ provider: active.id, description: description.trim() }, controller.signal);
      setRunning(null);
      onDraft(result, description.trim());
    } catch (err) {
      setRunning(null);
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    }
  };

  const importCode = async () => {
    if (!active) return;
    const controller = new AbortController();
    setError("");
    setElapsed(0);
    setRunning({ controller, startedAt: Date.now(), what: "import" });
    try {
      const result = await api.aiImport(active.id, controller.signal);
      setRunning(null);
      onImport(result);
    } catch (err) {
      setRunning(null);
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    }
  };

  const noAi = providers.length > 0 && !active;
  const status = running && (
    <>
      <span className="ai-status">
        <span className="ai-pulse" aria-hidden="true">
          <Icon name="sparkle" size={14} />
        </span>
        {active?.label} is {running.what === "import" ? "reading your code" : "drawing your flow"}…{" "}
        {elapsed > 0 && <span className="ai-elapsed">{elapsed}s</span>}
      </span>
      <button type="button" className="button-quiet" onClick={() => running.controller.abort()}>
        Cancel
      </button>
    </>
  );

  if (fromCode === null) return <div className="welcome" aria-busy="true" />;

  if (fromCode) {
    return (
      <div className="welcome">
        <div className="welcome-card">
          <h1 className="welcome-title">Map the app you already have</h1>
          <p className="welcome-lead">
            This folder already has code. {active ? active.label : "AI"} can read it, without changing anything, and draw
            the flow it finds. Steps the code already does are marked as built, so from here on you change the app by
            changing the flowchart.
          </p>
          <div className="welcome-actions">
            {running ? (
              status
            ) : (
              <>
                <button type="button" className="button-primary button-large" disabled={!active} onClick={() => void importCode()}>
                  <Icon name="sparkle" size={16} /> Draw it from my code
                </button>
                <button type="button" className="button-quiet" onClick={() => setFromCode(false)}>
                  Describe a new app instead
                </button>
              </>
            )}
          </div>
          {running?.what === "import" && (
            <p className="welcome-note">Reading a whole project can take a few minutes. You can keep this tab open and wait.</p>
          )}
          {noAi && (
            <p className="welcome-note">
              To read your code, install <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">Claude Code</a> or{" "}
              <a href="https://github.com/openai/codex" target="_blank" rel="noreferrer">Codex CLI</a> and sign in once.
            </p>
          )}
          {error && (
            <p className="inspector-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="button-quiet welcome-skip" disabled={!!running} onClick={onBlank}>
            Start with a blank canvas
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1 className="welcome-title">What are you building?</h1>
        <p className="welcome-lead">
          Describe your app in a sentence or two. {active ? active.label : "AI"} will draw the first version of the flow,
          and you can change anything after.
        </p>

        <form
          className="welcome-form"
          data-busy={running ? true : undefined}
          onSubmit={(e) => {
            e.preventDefault();
            void draft();
          }}
        >
          <textarea
            ref={textRef}
            rows={3}
            value={description}
            readOnly={!!running}
            placeholder={EXAMPLES[0]}
            aria-label="Describe your app"
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void draft();
            }}
          />
          <div className="welcome-actions">
            {running ? (
              status
            ) : (
              <>
                <button type="submit" className="button-primary button-large" disabled={!active || !description.trim()}>
                  <Icon name="sparkle" size={16} /> Draw my flow
                </button>
                {!description && (
                  <button type="button" className="button-quiet" onClick={() => setDescription(EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)])}>
                    Show me an example
                  </button>
                )}
              </>
            )}
          </div>
          {noAi && (
            <p className="welcome-note">
              To draw with AI, install <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">Claude Code</a> or{" "}
              <a href="https://github.com/openai/codex" target="_blank" rel="noreferrer">Codex CLI</a> and sign in once. You can
              still start from a template below.
            </p>
          )}
          {error && (
            <p className="inspector-error" role="alert">
              {error}
            </p>
          )}
        </form>

        <div className="welcome-templates">
          <p className="welcome-subhead">Or start from a template</p>
          <div className="template-grid">
            {TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="template" disabled={!!running} onClick={() => onTemplate(t)}>
                <span className="template-preview" aria-hidden="true">
                  {t.flow.steps.slice(0, 5).map((s) => (
                    <i key={s.id} data-kind={s.kind} />
                  ))}
                </span>
                <span className="template-title">{t.title}</span>
                <span className="template-blurb">
                  {t.blurb}, {t.flow.steps.length} steps
                </span>
              </button>
            ))}
          </div>
        </div>

        {more.map(({ source, templates }) => (
          <div key={source.id} className="welcome-templates">
            <p className="welcome-subhead">{source.label}</p>
            <div className="template-grid">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="template"
                  disabled={!!running || !!opening}
                  onClick={() => void openTemplate(source.id, t.id)}
                >
                  <span className="template-preview" aria-hidden="true">
                    {(t.preview ?? []).slice(0, 5).map((kind, i) => (
                      <i key={i} data-kind={kind} />
                    ))}
                  </span>
                  <span className="template-title">
                    {t.title}
                    {t.price && <span className="template-price">{t.price}</span>}
                  </span>
                  <span className="template-blurb">
                    {opening === `${source.id}/${t.id}` ? "Opening…" : t.blurb}
                    {t.author && opening !== `${source.id}/${t.id}` ? `, by ${t.author}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

        <button type="button" className="button-quiet welcome-skip" disabled={!!running} onClick={onBlank}>
          Start with a blank canvas
        </button>
      </div>
    </div>
  );
}
