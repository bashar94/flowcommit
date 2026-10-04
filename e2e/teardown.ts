import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Removes the throwaway projects the test server made. */
export default async function teardown() {
  await rm(path.join(os.tmpdir(), `flowcommit-e2e-${process.env.E2E_PORT ?? "4368"}`), { recursive: true, force: true });
}
