/** Writes schema/flow-v<N>.schema.json from the flow definitions. Run with: npm run schema */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION } from "../packages/shared/src/flow.ts";
import { flowJsonSchemaText } from "../packages/shared/src/schema.ts";

const file = path.resolve(import.meta.dirname, `../schema/flow-v${SCHEMA_VERSION}.schema.json`);
writeFileSync(file, flowJsonSchemaText());
console.log(`Wrote ${path.relative(process.cwd(), file)}`);
