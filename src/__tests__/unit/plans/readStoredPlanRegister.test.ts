/**
 * {@link readStoredPlanRegister} — the stored row and nothing else. The port's own read imports a legacy
 * `plans.json` into an empty store; this one must not, because its caller (the paid Codex acceptance run) reads the
 * operator's real home and is promised never to change it. Over the real store-backed seams with an in-memory row.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { readStoredPlanRegister, storePlanRegisterPort } from "../../../plans/storePort.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryPlanRegisterSeams, memoryPlanRegisterStore } from "../../planRegisterFixture.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A temp home whose legacy `plans.json` registers one Codex row. */
function homeWithLegacyFile(): string {
  const home = mkdtempSync(join(tmpdir(), "stored-register-"));
  homes.push(home);
  const path = stateHomePaths({ home }).plansJson;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ rows: [{ alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" }], version: 1 }),
    "utf8",
  );
  return home;
}

describe("readStoredPlanRegister", () => {
  it("answers no register for an empty store, and imports nothing even with a legacy file present", async () => {
    const home = homeWithLegacyFile();
    const store = memoryPlanRegisterStore();

    const read = await readStoredPlanRegister({ home, seams: memoryPlanRegisterSeams({ store }) });

    expect(unwrap(read)).toBeUndefined();
    expect(store.rows.size).toBe(0);
    expect(store.closed).toBe(store.opened);
  });

  it("reads back the stored row once one exists, at its revision", async () => {
    const home = homeWithLegacyFile();
    const store = memoryPlanRegisterStore();
    const seams = memoryPlanRegisterSeams({ store });
    unwrap(await storePlanRegisterPort({ seams }).read({ home }));

    const stored = unwrap(await readStoredPlanRegister({ home, seams }))!;

    expect(stored.source).toBe("registered");
    expect(stored.revision).toBe(1);
    expect(stored.plans.map((plan) => plan.alias)).toEqual(["codex-one"]);
  });
});
