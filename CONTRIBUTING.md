# Contributing to FlowCommit

Thanks for helping. FlowCommit is a flowchart editor where the design is the spec and AI
agents build the code from it, so the best contributions make that loop clearer, faster
or more reliable.

## Before you start

- **Bugs:** open an issue with steps to reproduce, what you expected and what happened.
  A screenshot or the `.flowcommit/flow.json` that shows the problem helps a lot.
- **Bigger changes** (a new feature, a change to the flow file format, a new dependency):
  open an issue first so we can agree on the approach before you spend time on it.
- **Small fixes** (typos, clear bugs, tests): send a pull request straight away.

## Set up

You need Node 20.19 or newer, Git, and Chrome (for the editor tests).

```sh
npm install
npm run dev          # editor on http://localhost:5317, server on 4318
```

To try your change on a real project: `FLOWCOMMIT_PROJECT=/path/to/app npm run dev`.

## Check your change

```sh
npm run typecheck
npm test             # shared logic and layout
npm run test:e2e     # builds the app and drives the editor in Chrome
```

All three run on every pull request. Add a test when you fix a bug or add behavior: unit
tests sit next to the code (`*.test.ts`), editor tests are in `e2e/`.

## How the code is organized

| Folder | What it is |
|---|---|
| `packages/shared` | The flow file format, diffs, layout and sync logic. No browser or Node APIs. |
| `packages/server` | The local server, MCP server, Git and AI CLI integration |
| `packages/web` | The editor (React and React Flow) |
| `bin`, `scripts` | The `flowcommit` command and the bundled build |
| `e2e` | Editor tests (Playwright) |

## Style

- Match the code around you: TypeScript, small functions, a short comment where the *why*
  isn't obvious.
- Words in the interface are written for people who aren't programmers. Say what something
  does in plain language ("Save version", not "Commit"), use sentence case, and make error
  messages say what happened and how to fix it.
- Keep `flow.json` stable. Changes to its format need a migration and a note in the pull
  request, because people keep these files in Git for years.
- No new dependency without a reason in the pull request.

## Pull requests

- One topic per pull request, with a description of what changed and how you tested it.
- Screenshots or a short recording for anything visible in the editor.
- By sending a contribution you agree it's licensed under the project's
  [Apache License 2.0](LICENSE), as section 5 of the license describes.

## Be kind

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
