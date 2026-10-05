import { z } from "zod";
import { FlowFileSchema, SCHEMA_VERSION } from "./flow.ts";

export const FLOW_SCHEMA_URL = `https://raw.githubusercontent.com/bashar94/flowcommit/main/schema/flow-v${SCHEMA_VERSION}.schema.json`;

/**
 * The JSON Schema for `.flowcommit/flow.json`, made from the same definitions FlowCommit reads
 * flows with, so the two can't drift apart. Fields with a default may be left out.
 */
export function flowJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(FlowFileSchema, { io: "input", target: "draft-2020-12" }) as Record<string, unknown>;
  return { $schema: schema.$schema, $id: FLOW_SCHEMA_URL, title: "FlowCommit flow", ...schema };
}

export const flowJsonSchemaText = () => JSON.stringify(flowJsonSchema(), null, 2) + "\n";
