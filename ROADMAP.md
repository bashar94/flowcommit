# FlowCommit roadmap

## Where it stands

**Built and working**
- Flowchart editor with seven step types, each with its own shape (pill, box, diamond,
  browser window, API box, database cylinder), tags, instructions, images, videos and links
- View options: Simple (shapes and titles, for explaining) or Detailed, plus a shape legend
- Reading aids: colored Yes/No arrows, loop-backs routed around the side, path highlighting,
  step numbers, an outline of the whole flow, and a guided walkthrough
- Image mark-up: numbered boxes, arrows, pins and drawings with notes, sent to the AI
  builder as a marked-up image plus written notes with positions
- AI help on every text field and "draw my flow from a description", through the Claude Code
  or Codex CLI already installed (no API keys)
- Templates, Tidy up, Tab / + to add the next step, keyboard shortcuts
- Versions as Git commits of `.flowcommit/`, a timeline, a visual diff (added / removed /
  changed, word by word) and restore
- Git and GitHub: commit graph across branches, branch switching and creation, review a
  branch or pull request on the canvas, push / pull / check GitHub, live refresh when Git
  changes anywhere
- MCP server: Claude Code or Codex build the app step by step, with live status on each card
  (Building, Built, Changed since built, Needs your answer)

**Two-way sync:** design changes reach AI tools automatically (Claude Code hook, AGENTS.md,
`get_design_changes`, removals); code changes come back as suggestions you accept or dismiss
(agent suggestions, code-change detection, "suggest changes from edited code").

## Needed for the first version

These are the gaps that would stop a real vibe coder from adopting it. Roughly in order.

| # | Feature | Why it's needed |
|---|---|---|
| 1 | ~~Agent can suggest flow changes~~ | Done: suggestions, code-change detection and the Sync panel. |
| 2 | **Create a flow from an existing project** (code → flow) | Most people already have code. The AI reads the project and drafts the flowchart, with each step linked to its files, so they can start using FlowCommit on day one. |
| 3 | **Undo and redo** | People expect ⌘Z and ⌘⇧Z on a canvas. Today only versions and a few notifications can undo. |
| 4 | **Open a project from the app** | A start screen with "Open folder" and recent projects, instead of setting an environment variable. |
| 5 | **One-command install** | `npx flowcommit` in any project folder: a production build served by the local server, opening the browser automatically. |
| 6 | **Local server safety** | Check the Host header and require a per-session token, so websites can't reach the local server (DNS rebinding) and use the AI tools or read the flow. |
| 7 | **Sub-flows** | Group steps and zoom into a step to see its own flow. Without this, real-sized apps become unreadable. |
| 8 | **Copy, paste, duplicate and search** | Basic editing that every canvas tool has. |
| 9 | **Link design versions to code** | Record which code commit matches each design version, and offer "restore code too" when restoring, so FlowCommit is version control for the whole app, not only the drawing. |
| 10 | **Tests for the editor** | End-to-end tests (drawing, saving versions, building) so changes don't break the main flows. Today only the shared logic is tested. |

## Good to have in the first version

| Feature | Why |
|---|---|
| Open a step's files in your editor | The step lists the files the agent changed; make them clickable (VS Code, Cursor). |
| Export as image or PDF | Share the architecture in a doc, chat or pitch deck. |
| First-run tour | A 30-second guided tour of drawing, AI help, versions and building. |
| More templates | Booking, marketplace, SaaS dashboard, chat app. |

## Later

- Visual merge: resolve design conflicts between branches on the canvas (today a conflict
  shows a clear message and points to the file)
- Comments on a review, and approving a pull request from FlowCommit
- Comments and real-time collaboration; cloud sync and sharing links
- Live overlay: highlight where the running app is in the flow
- Acceptance criteria on steps that turn into tests; locked steps the AI must not change
- Photo of a whiteboard sketch to flowchart; voice notes on steps
- AI time and cost per step
- VS Code / Cursor extension; template marketplace
