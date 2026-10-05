/** A plugin for the editor tests: a share option, a builder, and a log of events. */
import { appendFileSync } from "node:fs";

export default {
  name: "e2e",
  apiVersion: 1,
  setup(flowcommit) {
    flowcommit.addShareTarget({
      id: "link",
      label: "Share a test link",
      async share({ project, flow }) {
        return { message: `Shared ${flow.nodes.length} steps.`, url: `https://example.com/share/${project.name}` };
      },
    });
    flowcommit.addBuildRunner({
      id: "cloud",
      label: "Test cloud",
      description: "Builds the flow somewhere else.",
      async start({ flow }) {
        return { message: `Started building ${flow.name}.` };
      },
    });
    for (const event of ["flowSaved", "versionSaved", "pushed", "projectOpened"]) {
      flowcommit.on(event, () => appendFileSync(process.env.E2E_EVENTS_FILE, `${event}\n`));
    }
  },
};
