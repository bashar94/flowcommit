# Changelog

## 0.1.1

- **Getting started guide** (`docs/getting-started.md`) for new apps and existing ones.
- **`.mcp.json` works for teammates:** FlowCommit no longer writes your folder's path into it,
  and installed copies tell Claude Code to start FlowCommit with `npx flowcommit`.
- The welcome screen no longer flickers in folders that already have code.
- The README and quick start now begin with `npx flowcommit`.
- Undo after starting from a template or a drafted flow: the automatic tidy-up is no longer
  a separate step, so one ⌘Z goes back, and a quick edit right after can always be undone.

## 0.1.0, first public release

FlowCommit's first version: design an app as a flowchart, let AI agents build it, and keep
every version in Git.

- **Flowchart editor** with seven step types, each with its own shape; instructions, images,
  videos and links on every step; tags; groups that fold into one card; undo and redo; copy,
  paste, duplicate and search; Simple and Detailed views, step numbers, an outline and a
  guided walkthrough.
- **Image mark-up:** numbered boxes, arrows, pins and drawings with notes, sent to AI agents
  as a marked-up image and written notes.
- **AI help** through the Claude Code or Codex CLI you already have: improve any text field,
  draw a flow from a description, or draw it from an existing project's code.
- **Build with AI:** an MCP server lets Claude Code or Codex build the flow step by step, with
  live status on every card.
- **Two-way sync:** design changes reach AI tools automatically; code changes come back as
  suggestions you accept or dismiss.
- **Versions in Git**, with a visual diff, restore, optional code in the same commit, and
  "open as a branch" to bring back design and code together.
- **Git and GitHub:** a commit graph across branches, switching and creating branches,
  reviewing branches and pull requests on the canvas, push and pull.
- **Secret check** before saving and pushing, for code and the design.
- **Projects:** open any folder, recent projects, new projects, and a `flowcommit` command
  that runs everything on one port.
- **Export** as PNG or PDF; open a step's code in your editor; first-run tips; six templates.
- **Plugins:** template sources, share targets, build runners and events.
- **The flow file format** documented, with a JSON Schema.
