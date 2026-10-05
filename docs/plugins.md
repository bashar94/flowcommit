# Writing a FlowCommit plugin

Plugins add choices to FlowCommit: more templates to start from, more ways to share a flow,
and more ways to build one. FlowCommit works fully without any plugin, and every plugin is
optional.

A plugin is a JavaScript module whose default export has a `name`, the plugin API version it
was written for, and a `setup` function:

```js
// my-plugin/index.mjs
export default {
  name: "my-plugin",
  apiVersion: 1,
  setup(flowcommit) {
    flowcommit.addShareTarget({
      id: "link",
      label: "Share a link",
      async share({ project, flow }) {
        const url = await uploadSomewhere(flow); // your code
        return { message: "Anyone with the link can view this flow.", url };
      },
    });
  },
};
```

The smallest complete example is [`examples/plugins/local-templates`](../examples/plugins/local-templates),
which offers templates from a folder on your computer. The types for everything below are in
[`packages/shared/src/plugin.ts`](../packages/shared/src/plugin.ts).

## Installing plugins

```sh
flowcommit plugin add flowcommit-plugin-something   # from npm
flowcommit plugin add ./path/to/my-plugin           # a folder or file on your computer
flowcommit plugin list
flowcommit plugin remove flowcommit-plugin-something
```

Plugins are listed in `~/.flowcommit/config.json` (or `$FLOWCOMMIT_HOME/config.json`), and the
ones from npm are installed in `~/.flowcommit/plugins/`. Restart FlowCommit after a change.
Start FlowCommit with `FLOWCOMMIT_NO_PLUGINS=1` to turn every plugin off for a moment.

**Plugins only ever come from your own settings, never from a project folder,** so opening
someone else's project can't run their code on your computer. Plugins run inside the local
FlowCommit server with the same access to your computer as FlowCommit itself, so only add
plugins you trust.

## What a plugin can add

`setup(flowcommit)` is called once when FlowCommit starts. It can be `async`.

### Template sources

Templates show up on the welcome screen, under the source's label, when someone starts a new
flow. A marketplace would be a template source.

```js
flowcommit.addTemplateSource({
  id: "starter-kits",
  label: "Starter kits",
  async list() {
    return [{ id: "saas", title: "SaaS starter", blurb: "Sign-up, billing, teams", preview: ["start", "screen", "api", "data", "end"], price: "$19", author: "Acme" }];
  },
  async get(id) {
    return { id, title: "SaaS starter", blurb: "", description: "A subscription app.", flow: { name: "SaaS", steps: [], arrows: [] } };
  },
});
```

`get` returns the template's flow as steps and arrows (the same shape AI drafts use: each step
has an `id`, `kind`, `title` and `instructions`, each arrow a `from`, `to` and `label`), or
`null` if it isn't available to this person. FlowCommit lays the steps out itself.

### Share targets

Each one is a button under **View → Share a picture**. `share` gets the project and its
current flow and returns a message to show, plus a link if there is one.

### Build runners

Each one is a tab in the **Build** window, next to Claude Code and Codex. `start` gets the
project and its flow, and returns a message (and a link to follow progress, if there is one).
A cloud builder would be a build runner.

### Events

```js
flowcommit.on("versionSaved", ({ project, sha, message, withCode }) => { /* back it up */ });
```

| Event | When | What it gets |
|---|---|---|
| `flowSaved` | A moment after every edit, when the design is written to disk | `project`, `flow` |
| `versionSaved` | A version is saved | `project`, `sha`, `message`, `withCode` |
| `pushed` | Commits are pushed to GitHub | `project`, `branch` |
| `projectOpened` | FlowCommit starts or opens another project | `project` |

FlowCommit doesn't wait for event handlers, and their errors only go to the log, so a slow or
broken plugin can't get in anyone's way.

### Logging

`flowcommit.log(message)` writes to FlowCommit's log with the plugin's name in front.

## Rules for plugins

- Calls time out: listing templates after 15 seconds, everything else after 2 minutes.
- Ids only need to be unique within your plugin; FlowCommit puts your plugin's name in front.
- Never change `.flowcommit/` files yourself. Read the flow you're given.
- `apiVersion` must be `1`. When the API changes in a way that breaks plugins, the number goes
  up, and FlowCommit tells people which plugins need an update instead of loading them.
