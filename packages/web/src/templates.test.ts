import { test } from "node:test";
import assert from "node:assert/strict";
import { DraftFlowSchema } from "@flowcommit/shared";
import { TEMPLATES } from "./templates.ts";

test("every template is a valid flow that starts once and ends", () => {
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  for (const t of TEMPLATES) {
    const flow = DraftFlowSchema.parse(t.flow);
    const ids = new Set(flow.steps.map((s) => s.id));
    assert.equal(ids.size, flow.steps.length, `${t.id}: step ids repeat`);
    assert.equal(flow.steps.filter((s) => s.kind === "start").length, 1, `${t.id}: needs one start`);
    assert.ok(flow.steps.some((s) => s.kind === "end"), `${t.id}: needs an end`);
    for (const a of flow.arrows) assert.ok(ids.has(a.from) && ids.has(a.to), `${t.id}: arrow ${a.from} to ${a.to}`);
    for (const s of flow.steps.filter((x) => x.kind === "decision")) {
      const out = flow.arrows.filter((a) => a.from === s.id);
      assert.ok(out.length >= 2 && out.every((a) => a.label), `${t.id}: decision "${s.title}" needs labeled answers`);
    }
  }
});
