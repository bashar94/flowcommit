import { test } from "node:test";
import assert from "node:assert/strict";
import { describeAnnotations } from "./annotations.ts";

test("marks are described with numbers, places and notes", () => {
  const lines = describeAnnotations([
    { id: "1", kind: "box", color: "red", points: [[0.05, 0.02], [0.3, 0.12]], note: "Make the logo bigger" },
    { id: "2", kind: "arrow", color: "red", points: [[0.5, 0.5], [0.85, 0.4]], note: "Move the button here" },
    { id: "3", kind: "pin", color: "blue", points: [[0.5, 0.9]], note: "" },
  ]);
  assert.deepEqual(lines, [
    "1. Box around the top left (x 5%–30%, y 2%–12%): Make the logo bigger",
    "2. Arrow pointing to the middle right (x 85%, y 40%), drawn from the middle: Move the button here",
    "3. Pin at the bottom center (x 50%, y 90%): (no note)",
  ]);
});
