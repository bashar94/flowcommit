# Local templates, an example FlowCommit plugin

Start new flows from templates you keep in a folder on your computer. It's also the smallest
complete example of a FlowCommit plugin, so it's a good place to start writing your own.

## Use it

```sh
flowcommit plugin add /path/to/flowcommit/examples/plugins/local-templates
mkdir -p ~/.flowcommit/templates
```

Put one JSON file per template in `~/.flowcommit/templates` (the format is at the top of
`index.mjs`), then restart FlowCommit. Your templates appear under **Your templates** when you
start a new flow.

## How it works

The plugin's default export has a `name`, the plugin API version it was written for, and a
`setup` function. `setup` adds one template source with a `list` and a `get` function. See
[docs/plugins.md](../../../docs/plugins.md) for everything a plugin can add.
