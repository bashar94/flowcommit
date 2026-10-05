/**
 * An example FlowCommit plugin: templates from a folder on your computer.
 *
 * Put template files in ~/.flowcommit/templates (or the folder in FLOWCOMMIT_TEMPLATES_DIR),
 * one JSON file per template:
 *
 *   {
 *     "title": "Newsletter sign-up",
 *     "blurb": "Form, confirm email, welcome",
 *     "description": "A sign-up page for a newsletter with double opt-in.",
 *     "flow": {
 *       "name": "Newsletter",
 *       "steps": [{ "id": "s1", "kind": "start", "title": "Visitor opens the page" }, ...],
 *       "arrows": [{ "from": "s1", "to": "s2" }, ...]
 *     }
 *   }
 *
 * They show up under "Your templates" when you start a new flow. The file name is the id.
 */
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const folder = () => process.env.FLOWCOMMIT_TEMPLATES_DIR ?? path.join(os.homedir(), ".flowcommit", "templates");

async function read(file) {
  const data = JSON.parse(await readFile(path.join(folder(), file), "utf8"));
  const id = file.replace(/\.json$/, "");
  const steps = data.flow?.steps ?? [];
  return {
    id,
    title: data.title ?? data.flow?.name ?? id,
    blurb: data.blurb ?? `${steps.length} steps`,
    description: data.description ?? "",
    preview: steps.map((s) => s.kind),
    author: data.author,
    flow: data.flow,
  };
}

export default {
  name: "local-templates",
  apiVersion: 1,
  setup(flowcommit) {
    flowcommit.addTemplateSource({
      id: "folder",
      label: "Your templates",
      async list() {
        const files = await readdir(folder()).catch(() => []);
        const templates = [];
        for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
          try {
            const { flow: _flow, description: _description, ...summary } = await read(file);
            templates.push(summary);
          } catch (err) {
            flowcommit.log(`Skipped ${file}: ${err.message}`);
          }
        }
        return templates;
      },
      async get(id) {
        if (!/^[\w.-]+$/.test(id)) return null;
        return read(`${id}.json`).catch(() => null);
      },
    });
  },
};
