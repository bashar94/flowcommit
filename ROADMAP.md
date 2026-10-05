# FlowCommit roadmap

## Where it stands

**Built and working**
- Flowchart editor with seven step types, each with its own shape (pill, box, diamond,
  browser window, API box, database cylinder), tags, instructions, images, videos and links
- Groups: name parts of the flow, drag them as one, and fold them into a single card
- View options: Simple (shapes and titles, for explaining) or Detailed, plus a shape legend
- Reading aids: colored Yes/No arrows, loop-backs routed around the side, path highlighting,
  step numbers, an outline of the whole flow, and a guided walkthrough
- Image mark-up: numbered boxes, arrows, pins and drawings with notes, sent to the AI
  builder as a marked-up image plus written notes with positions
- AI help on every text field, "draw my flow from a description", and "draw it from my
  code" for existing projects, through the Claude Code or Codex CLI already installed
- Six templates, Tidy up, Tab / + to add the next step, undo and redo, copy, paste,
  duplicate, search, export as PNG or PDF, first-run tips
- Versions as Git commits, optionally with the code, a timeline, a visual diff (added /
  removed / changed, word by word), restore, and "open as a branch" to bring back design and
  code together
- Git and GitHub: commit graph across branches, branch switching and creation, review a
  branch or pull request on the canvas, push / pull / check GitHub, live refresh when Git
  changes anywhere
- MCP server: Claude Code or Codex build the app step by step, with live status on each card
- Two-way sync: design changes reach AI tools automatically (Claude Code hook, AGENTS.md,
  `get_design_changes`, removals); code changes come back as suggestions you accept or dismiss
- Projects: `flowcommit` command (one port, opens the browser), open any folder, recent
  projects, new projects; the local server only answers this computer's own pages
- Secret check before saving and pushing, for code and the design, and for AI agents
- Plugins: template sources, share targets, build runners and events, with an example plugin
  and `flowcommit plugin add | remove | list`
- The `flow.json` format documented, with a JSON Schema kept in step with the code
- Tests: shared logic (`npm test`) and the editor end to end (`npm run test:e2e`)

## Next

| To do | Why |
|---|---|
| Publish to npm | So `npx flowcommit` works without cloning this repo. |
| A sign-in connection point for plugins | Paid services need to know who's signed in; today each plugin handles that itself. |
| More example plugins | A share-link and a backup example would help people build their own. |

## Later

- Zoom into a step to give it its own flow (nested flows), beyond folding groups
- Visual merge: resolve design conflicts between branches on the canvas (today a conflict
  shows a clear message and points to the file)
- Comments on a review, and approving a pull request from FlowCommit
- Comments and real-time collaboration; cloud sync and sharing links
- Live overlay: highlight where the running app is in the flow
- Acceptance criteria on steps that turn into tests; locked steps the AI must not change
- Photo of a whiteboard sketch to flowchart; voice notes on steps
- AI time and cost per step
- VS Code / Cursor extension; template marketplace
