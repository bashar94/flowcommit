import { useEffect, useState } from "react";
import { api } from "./api.ts";

/** Code editors that open a file from a link. "system" asks the computer's default app instead. */
export const EDITORS = {
  vscode: { label: "VS Code", link: (p: string) => `vscode://file${encodeURI(p)}` },
  cursor: { label: "Cursor", link: (p: string) => `cursor://file${encodeURI(p)}` },
  windsurf: { label: "Windsurf", link: (p: string) => `windsurf://file${encodeURI(p)}` },
  zed: { label: "Zed", link: (p: string) => `zed://file${encodeURI(p)}` },
  jetbrains: { label: "JetBrains IDE", link: (p: string) => `idea://open?file=${encodeURIComponent(p)}` },
  system: { label: "Default app", link: null },
} as const;
export type EditorId = keyof typeof EDITORS;

const KEY = "flowcommit.editor";

export function readEditor(): EditorId {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved in EDITORS) return saved as EditorId;
  } catch {
    // Storage can be off; fall back to the most common editor.
  }
  return "vscode";
}

export function saveEditor(id: EditorId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // The choice just won't be remembered.
  }
}

let projectRoot: Promise<string> | null = null;

/** The open project's folder, so file links can use full paths. */
export function useProjectRoot(): string | null {
  const [root, setRoot] = useState<string | null>(null);
  useEffect(() => {
    projectRoot ??= api.project().then((p) => p.path);
    projectRoot.then(setRoot).catch(() => (projectRoot = null));
  }, []);
  return root;
}

/** Opens a project file in the chosen editor. */
export function openInEditor(editor: EditorId, root: string, file: string) {
  const full = `${root.replace(/\/$/, "")}/${file}`;
  const link = EDITORS[editor].link;
  if (link) window.location.href = link(full);
  else void api.openFile(file);
}
