import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION } from "./flow.ts";
import { flowJsonSchemaText } from "./schema.ts";

test("the published JSON Schema matches the code (run npm run schema to update it)", () => {
  const file = path.resolve(import.meta.dirname, `../../../schema/flow-v${SCHEMA_VERSION}.schema.json`);
  assert.equal(readFileSync(file, "utf8"), flowJsonSchemaText());
});
