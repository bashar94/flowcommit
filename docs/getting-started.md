# Getting started

This guide takes you from nothing to an app that AI builds from your flowchart, either for a
brand-new app or for an app you already have.

## Before you start

You need:

- **[Node.js](https://nodejs.org) 20.19 or newer.** Check with `node --version`.
- **Git.** Check with `git --version`. FlowCommit keeps every version of your design in Git.
- **An AI coding tool**, signed in once:
  [Claude Code](https://claude.com/claude-code) (`claude`) or
  [Codex CLI](https://github.com/openai/codex) (`codex`). FlowCommit uses the one you have, with
  your own sign-in. There are no FlowCommit accounts or API keys.

You can draw flows without an AI tool. You need one to build the code, to have AI write or
improve text, and to draw a flow from existing code.

## Starting a new app

**1. Make a folder and open FlowCommit in it.**

```sh
mkdir my-app && cd my-app
npx flowcommit
```

FlowCommit opens in your browser. Keep the terminal open while you work; press Ctrl+C there
to stop FlowCommit.

You can also start a new project from inside FlowCommit: click the project name at the top
left and choose **New project**. That makes the folder and turns on Git for you.

**2. Draw the first version of the flow.** The welcome screen offers three ways:

- **Describe your app** in a sentence or two and click **Draw my flow**. Your AI tool drafts
  the steps.
- **Start from a template**, like sign-up and log-in, or an online store checkout.
- **Start with a blank canvas.**

**3. Make it yours.** Click a step to edit it on the right:

- **Title** and **instructions**: what the step does, written for the AI that will build it.
  Be specific: "Ask for email and password; show errors under each field" builds better than
  "Login page". Click **AI** next to a text box to have it improved or written for you.
- **Type**: Screen for pages people see, API for server work, Data for what gets stored,
  Decision for a yes/no choice (each choice is an arrow with a label, like "Yes" and "No").
- **Attachments**: drop in a mockup or screenshot, and click **Mark up** to draw numbered
  boxes and arrows with notes on it.

Press **Tab** to add the next step after the selected one, and drag from the dot under a card
to draw an arrow.

**4. Save a version.** Click **Save version** (or press ⌘S). If the folder isn't a Git
repository yet, FlowCommit offers to turn version history on.

**5. Connect your AI tool and build.** See [Building with AI](#building-with-ai) below.

## Starting from an app you already have

**1. Open FlowCommit in your app's folder.**

```sh
cd path/to/your-app
npx flowcommit
```

**2. Let AI map your app.** Because the folder already has code, the welcome screen offers
**Draw it from my code**. Your AI tool reads the project, without changing anything, and
draws the flow it finds: the screens, the server work, the data and the decisions. This can
take a few minutes on a big project.

- Each part of the app (an area people use, an API, a background job, an AI feature) becomes
  a **group**. In a big app the groups start folded, so you see all the parts at a glance;
  click one to open it.
- Steps the code already does are marked **Built**, and linked to the files that do them.
- Steps the code only partly does (a stub, a TODO) are left unbuilt, with what's missing in
  their instructions.

**3. Check the flow.** It's a first draft. Fix titles and merge steps that are really one. If
a part of the app is missing, open **Sync**, type it under **Add a part that's missing** (like
"the AI chatbot"), and click **Draw it**: AI reads that part's code and adds it as a new group,
joined to the steps it connects to, without changing the rest of your flow.

**4. Save a version.** From now on, you change the app by changing the flowchart.

**5. Connect your AI tool.** See the next section. When you change a step, the AI rebuilds
only what changed.

What FlowCommit adds to your project:

| File | What it is | Commit it? |
|---|---|---|
| `.flowcommit/flow.json` | The flowchart | Yes; FlowCommit's versions do this for you |
| `.flowcommit/assets/` | Images and videos on steps | Yes |
| `.flowcommit/status.json`, `suggestions.json` | Build progress and AI suggestions on this computer | No; FlowCommit keeps them out of Git |
| `.mcp.json` | Tells Claude Code how to reach FlowCommit (when you connect it) | Yes, so teammates get it too |
| `.claude/settings.json` | The hook that tells Claude about design changes (optional) | Yes |
| `AGENTS.md` | A short FlowCommit section for Codex and other agents (optional) | Yes |

Nothing else in your code is changed by FlowCommit itself.

## Building with AI

Click **Build** at the top right. It shows how far the build has got, and how to connect your
AI tool.

### With Claude Code

1. In the Build window, click **Add to project**. Keep **Keep Claude in sync automatically**
   ticked: then, at the start of each message, Claude is told what changed in the design.
2. In a terminal, in your project folder, start Claude Code:

   ```sh
   claude
   ```

   The first time, Claude Code asks whether to use the `flowcommit` server from `.mcp.json`.
   Approve it. It may also ask you to trust the hook in `.claude/settings.json`.
3. Ask it: **"Build my app from the FlowCommit flow"**, or type `/mcp__flowcommit__build`.

Claude builds one step at a time. In FlowCommit, each card shows **Building** and then
**Built**. If an instruction is unclear, the step shows **Needs your answer** with Claude's
question: update the instructions, then click **Mark ready to build** in the step's details.
You approve Claude's code changes in the terminal, as usual.

### With Codex CLI

1. In the Build window, choose **Codex CLI** and run the command it shows once, in a terminal.
   It adds FlowCommit to your Codex settings.
2. Click **Add to AGENTS.md**. Codex reads that file before every task, so it checks for
   design changes and suggests flow updates on its own.
3. Start Codex in your project folder and ask it to build:

   ```sh
   codex "Build my app from the FlowCommit flow"
   ```

FlowCommit doesn't have to be open while the AI builds. If it is, you see each step light up.

## Day to day

- **Change the design, then sync.** Edit, add or remove steps in FlowCommit. Then, in Claude
  Code, just keep working (with the hook it already knows what changed) or type
  `/mcp__flowcommit__sync`. In Codex, ask "Sync the code with the FlowCommit flow". The AI
  builds new steps, rebuilds changed ones and removes the code of deleted ones.
- **Changes made in the code come back.** When the AI builds something the flowchart doesn't
  show, or you ask it for a change directly in chat, it suggests a flow change. Open **Sync**
  at the top to accept or dismiss each suggestion. Code edited by hand after a step was built
  shows **Code changed**; Sync can ask AI how the flowchart should change.
- **Save versions as you go.** When the code changed too, tick **Include my code changes** so
  the version holds the design and the code that builds it. FlowCommit checks for passwords
  and API keys before saving.
- **Look back.** **History** shows every version as a graph. Click one to see what changed on
  the canvas: green added, red removed, yellow changed. **Restore this design** brings back
  only the drawing; **Open as a branch** brings back the design and the code together.
- **Read and explain.** **View → Simple** shows only shapes and titles, with an outline, which
  is the clearest way to explain the app. **Walk through** goes through it step by step.

## Details for developers

Each step can say where it is in the code, what it uses, and rules the code must follow. Open
**For developers** at the bottom of a step's details:

- **Route, endpoint, table or function**, depending on the type of step: `/cart`,
  `POST /api/checkout`, `orders (id, total, status)`, `sendReceiptEmail()`.
- **Uses:** services and libraries, like Stripe or Supabase.
- **Rules:** one per line, like "Never store card numbers". The AI must follow them, and asks
  you when it can't.

With no step selected, the same section holds what the whole app is **built with** and rules
for every step. The card shows one quiet line with the route or endpoint and a service; turn it
off with **View → Developer details**, or use **Simple**. Search (⌘F) finds steps by what they
use, so searching "Stripe" lights up every step that touches it.

You rarely need to type these: **Draw it from my code** fills them in, and AI agents report what
they built as they finish each step. A reviewer sees changes to them in History, like a new
endpoint or a step that now uses Stripe.

## Working with GitHub and a team

FlowCommit uses your project's Git repository and your own Git sign-in, so everything also
works from the terminal.

- **Push and pull** from the branch button at the top. FlowCommit checks for secrets before
  pushing.
- **Branches:** try a design idea on a new branch from the same menu. Switching branches
  switches the code too, like `git switch`.
- **Review:** see what a branch changed, on the canvas. With the GitHub CLI signed in
  (`gh auth login`), open pull requests show up there too.
- Teammates who clone the repo get the flowchart, the `.mcp.json` and the hook. They run
  `npx flowcommit` in the folder, and approve the server once in Claude Code.

## If something goes wrong

| Problem | What to do |
|---|---|
| `Port 4318 is already used` | Another FlowCommit is running. FlowCommit picks the next free port by itself; with `--port`, pick another number. |
| The AI buttons are greyed out | Install Claude Code or Codex CLI and sign in once, then reload FlowCommit. The AI picker at the top shows what it found. |
| Claude Code doesn't know the `flowcommit` tools | Start `claude` in the project folder (where `.mcp.json` is), and approve the server when asked. `/mcp` in Claude Code lists connected servers. |
| "The design has a merge conflict from Git" | Two branches changed the flow. Open `.flowcommit/flow.json` in your code editor and keep one side of each `<<<<<<<` block, or run `git merge --abort`. |
| History says version history isn't turned on | The folder isn't a Git repository yet. Click **Turn on version history**. |
| Something else | [Open an issue](https://github.com/bashar94/flowcommit/issues) with what you did and what happened. |

## Commands

```sh
npx flowcommit                # open FlowCommit for the current folder
npx flowcommit ~/my-app       # or for another folder
npx flowcommit --port 4400    # on a particular port
npx flowcommit --no-open      # without opening the browser
npx flowcommit plugin list    # plugins: add, remove, list (see docs/plugins.md)
```

Install it once with `npm install -g flowcommit` to use plain `flowcommit` instead of
`npx flowcommit`.
