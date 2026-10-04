/**
 * Claude Code runs this at the start of every message the person sends (a UserPromptSubmit
 * hook). Whatever it prints is added to Claude's context, so Claude learns about design
 * changes without being told. It prints nothing when the code already matches the design,
 * and never fails loudly: a broken hook must not get in the way of the person's message.
 */
import { hasPending, pendingChanges, pendingSummary } from "@flowcommit/shared";
import { Project } from "./project.ts";
import { findDrift } from "./codeSync.ts";

function projectRoot(): string {
  const i = process.argv.indexOf("--project");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}

try {
  const project = new Project(projectRoot());
  const [flow, status, suggestions] = await Promise.all([project.readFlow(), project.readStatus(), project.readSuggestions()]);
  const pending = pendingChanges(flow, status);
  const drift = await findDrift(project, flow, status);
  const lines: string[] = [];
  if (hasPending(pending)) lines.push(pendingSummary(pending));
  if (drift.length) {
    lines.push(
      `FlowCommit: code for ${drift.length} built ${drift.length === 1 ? "step" : "steps"} (${drift
        .slice(0, 3)
        .map((d) => `"${d.title}"`)
        .join(", ")}) changed outside a build. If you changed it, call suggest_flow_change so the flowchart describes what the code now does.`,
    );
  }
  if (suggestions.suggestions.length) {
    const n = suggestions.suggestions.length;
    lines.push(`FlowCommit: ${n} flow ${n === 1 ? "suggestion is" : "suggestions are"} waiting for the person to review.`);
  }
  if (lines.length) process.stdout.write(lines.join("\n") + "\n");
} catch {
  // Not a FlowCommit project, or something unexpected: stay silent.
}
