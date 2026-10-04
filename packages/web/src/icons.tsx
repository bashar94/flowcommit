import type { NodeKind } from "@flowcommit/shared";

/** Small line icons drawn on a 20×20 grid with the current text color. */
const paths: Record<NodeKind | "sparkle" | "plus" | "close" | "check" | "chevron" | "image" | "link" | "undo" | "tidy" | "alert" | "copy" | "hammer" | "eye" | "tag" | "arrowRight" | "pin" | "pen" | "markup" | "branch" | "cloud" | "upload" | "download" | "github" | "sync", string> = {
  start: "M6.5 4.8v10.4L15 10z",
  step: "M4 6.5h12M4 10h12M4 13.5h7",
  decision: "M10 2.8 17.2 10 10 17.2 2.8 10z",
  screen: "M3 4.5h14v9.5H3zM7 17h6M10 14v3",
  api: "M7 6 3 10l4 4M13 6l4 4-4 4M11.2 4.5l-2.4 11",
  data: "M4 5.5c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5-2.7 2.5-6 2.5-6-1.1-6-2.5zm0 0v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5",
  end: "M5 5h10v10H5z",
  sparkle: "M10 2.5c.5 3.6 2 5.6 5.5 6.3v.4c-3.5.7-5 2.7-5.5 6.3h-.4c-.5-3.6-2-5.6-5.5-6.3v-.4c3.5-.7 5-2.7 5.5-6.3zM15.5 13.5c.2 1.4.8 2.1 2 2.4-1.2.3-1.8 1-2 2.4-.2-1.4-.8-2.1-2-2.4 1.2-.3 1.8-1 2-2.4z",
  plus: "M10 4v12M4 10h12",
  close: "M5 5l10 10M15 5 5 15",
  check: "M4 10.5 8 14.5 16 5.5",
  chevron: "M6 8l4 4 4-4",
  image: "M3 4.5h14v11H3zM3 13l4-4 3 3 2-2 5 4.5M12.5 8.2a1.2 1.2 0 1 0 0-.1",
  link: "M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1",
  undo: "M7 5 3.5 8.5 7 12M4 8.5h7.5a4.5 4.5 0 0 1 0 9H9",
  tidy: "M7 3h6v4H7zM3 13h6v4H3zM11 13h6v4h-6zM10 7v3M6 13v-3h8v3",
  alert: "M10 3 18 17H2zM10 8.5v3.5M10 14.6v.1",
  copy: "M7 7h9v10H7zM4 13V3h9",
  eye: "M2 10s3-5.5 8-5.5 8 5.5 8 5.5-3 5.5-8 5.5S2 10 2 10zM10 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z",
  tag: "M3 3h6.5L17 10.5 10.5 17 3 9.5zM6.5 6.6v.1",
  arrowRight: "M3.5 16.5 15.5 4.5M8.5 4.5h7v7",
  pin: "M10 17.5s-5.5-5-5.5-9a5.5 5.5 0 0 1 11 0c0 4-5.5 9-5.5 9zM10 10.2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  pen: "M3.5 16.5c2-1 3.5-4 6-6.5s4.5-4.5 6.5-4c1.5.4.5 3-2 5.5s-4 3.5-4 5",
  markup: "M3 4.5h14v11H3zM6.5 8.5h4v3h-4zM12.5 12.5l2.5 2.5",
  branch: "M6 3.5v13M6 16.5a1.8 1.8 0 1 0 0-.1M6 3.5a1.8 1.8 0 1 0 0 .1M14 5.5a1.8 1.8 0 1 0 0 .1M14 7.3c0 4-8 3-8 7.5",
  cloud: "M6 15.5h8.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.2A3 3 0 0 0 6 15.5z",
  upload: "M10 14V4M6 8l4-4 4 4M4 16.5h12",
  sync: "M4 8a6 6 0 0 1 10.5-3M16 4v3.5h-3.5M16 12a6 6 0 0 1-10.5 3M4 16v-3.5h3.5",
  download: "M10 4v10M6 10l4 4 4-4M4 16.5h12",
  github: "M10 2.5a7.5 7.5 0 0 0-2.4 14.6c.4.1.5-.2.5-.4v-1.3c-2.1.5-2.5-1-2.5-1-.4-.9-.9-1.1-.9-1.1-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.8.8 2.3.6.1-.5.3-.8.5-1-1.7-.2-3.4-.8-3.4-3.7 0-.8.3-1.5.8-2-.1-.2-.4-1 .1-2 0 0 .6-.2 2.1.8a7 7 0 0 1 3.8 0c1.4-1 2.1-.8 2.1-.8.4 1 .2 1.8.1 2 .5.5.8 1.2.8 2 0 2.9-1.8 3.5-3.4 3.7.3.2.5.7.5 1.4v2.1c0 .2.1.5.6.4A7.5 7.5 0 0 0 10 2.5z",
  hammer: "M11.5 3.5 16.5 8.5 14 11 9 6zM10.5 7.5 3.5 14.5a1.4 1.4 0 0 0 2 2L12.5 9.5",
};

const FILLED = new Set(["start", "sparkle", "github"]);

export function Icon({ name, size = 16 }: { name: keyof typeof paths; size?: number }) {
  const filled = FILLED.has(name);
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="icon"
    >
      <path d={paths[name]} />
    </svg>
  );
}

/** Two steps joined by an arrow that ends in a commit dot. */
export function Logo() {
  return (
    <svg viewBox="0 0 28 28" width="24" height="24" aria-hidden="true" className="logo">
      <rect x="2" y="3" width="11" height="8" rx="2.5" fill="var(--accent)" />
      <rect x="15" y="17" width="11" height="8" rx="2.5" fill="var(--k-screen)" />
      <path d="M7.5 11v4.5a4 4 0 0 0 4 4H15" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="20.5" cy="7" r="3.2" fill="none" stroke="var(--ink)" strokeWidth="2" />
    </svg>
  );
}
