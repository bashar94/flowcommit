# The flow file format

Every FlowCommit project keeps its design in `.flowcommit/flow.json`, next to the code. It's a
plain JSON file, so it works with Git, code review and any tool that reads JSON. This page is
the specification for **version 1** of the format.

- JSON Schema: [`schema/flow-v1.schema.json`](../schema/flow-v1.schema.json)
- Made from the same definitions FlowCommit reads files with: `packages/shared/src/flow.ts`

## A small example

```json
{
  "schema": 1,
  "name": "Online store",
  "description": "A small online store with card payments.",
  "groups": [{ "id": "g-1a2b3c4d", "title": "Checkout" }],
  "nodes": [
    { "id": "start", "kind": "start", "title": "Shopper lands on store", "instructions": "", "attachments": [], "tags": [], "position": { "x": 0, "y": 0 } },
    { "id": "pay", "kind": "api", "title": "Charge the card", "instructions": "Use Stripe. Never store card numbers.", "attachments": [], "tags": ["payments"], "group": "g-1a2b3c4d", "position": { "x": 0, "y": 176 } }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "pay", "label": "" }
  ]
}
```

## The parts

| Field | What it is |
|---|---|
| `schema` | The format version. Always `1` for now. |
| `name` | The app's name. |
| `description` | What the app is. AI agents read it before building any step. |
| `groups` | Named parts of the flow, like "Checkout". A step belongs to a group through its `group` field. |
| `nodes` | The steps. |
| `edges` | The arrows between steps. |

### Steps (`nodes`)

| Field | What it is |
|---|---|
| `id` | Unique in the file and never reused, so versions can be compared step by step. |
| `kind` | `start`, `step`, `decision`, `screen`, `api`, `data` or `end`. It sets the shape: pills for start and end, a diamond for decisions, a browser window for screens, a box with side bars for APIs, a cylinder for data. |
| `title` | A few words, like "Charge the card". |
| `instructions` | What to build, written for the AI agent. Markdown is allowed. |
| `attachments` | Images, videos and links, each with a caption. Images can carry numbered marks (`annotations`) with notes. |
| `tags` | Short labels like `auth` or `MVP`. |
| `group` | The id of the group the step is in, if any. |
| `position` | Where the step sits on the canvas, in pixels. Moving a step isn't a design change. |

Uploaded images and videos live in `.flowcommit/assets/`; `src` is the file name there. For a
link, `src` is the full URL. An image's marks are stored as points measured in fractions of
the image (0 to 1), so they fit any size. `annotatedSrc`, when present, is a copy of the image
with the marks drawn on, for AI tools.

### Arrows (`edges`)

| Field | What it is |
|---|---|
| `source`, `target` | The ids of the steps the arrow joins. |
| `label` | Words on the arrow, like "Yes" and "No" after a decision. |
| `sourceHandle` | `left` or `right` for an arrow leaving a decision from a side corner. Left out for the bottom. |

## Rules readers and writers follow

- **Fields with a default can be left out.** `description`, `groups`, `instructions`,
  `attachments`, `tags` and `label` default to empty. Writers should still include them, so
  every file looks the same.
- **Unknown fields are ignored** when reading. Don't rely on them surviving a save.
- **Every arrow points at steps that exist.** A file where they don't is invalid.
- **A step in a group that doesn't exist is ungrouped**, and groups without steps are dropped.
- **FlowCommit writes files in a fixed order** (steps and arrows sorted by id, positions
  rounded, keys in the order above) so that Git diffs stay small. Other writers are encouraged
  to do the same.

## Files next to it

| File | What it is | In Git? |
|---|---|---|
| `.flowcommit/flow.json` | The design | Yes |
| `.flowcommit/assets/` | Images and videos attached to steps | Yes |
| `.flowcommit/status.json` | Which steps are built, by which agent, from which files | No, it's local |
| `.flowcommit/suggestions.json` | Flow changes AI agents suggested, waiting for review | No, it's local |

FlowCommit adds a `.flowcommit/.gitignore` that keeps the local files out of versions.

## Changes to the format

The format only changes in ways that keep old files readable. A change that old versions of
FlowCommit couldn't read raises `schema` to `2`, comes with an automatic upgrade of version 1
files, and gets its own schema file next to this one.
