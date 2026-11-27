/**
 * {@link readOnlyStorePlanRegisterPort} — the port `supervisor chair-watch` reads every register through. It must read
 * what the ordinary port reads and change nothing: no one-time import, no write, no seat-pass clear. Over the real
 * store-backed seams with an in-memory row.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { readOnlyStorePlanRegisterPort, storePlanRegisterPort } from "../../../plans/storePort.js";
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
  const home = mkdtempSync(join(tmpdir(), "read-only-register-"));
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

describe("readOnlyStorePlanRegisterPort", () => {
  it("refuses to import a register file into an empty store, where the ordinary port would import it", async () => {
    const home = homeWithLegacyFile();
    const store = memoryPlanRegisterStore();

    const read = await readOnlyStorePlanRegisterPort({ seams: memoryPlanRegisterSeams({ store }) }).read({ home });

    expect(unwrapErr(read).code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(unwrapErr(read).message).toContain("import the plan register");
    expect(store.rows.size).toBe(0);
    expect(store.closed).toBe(store.opened);
  });

  it("reads a stored row exactly as the ordinary port does", async () => {
    const home = homeWithLegacyFile();
    const store = memoryPlanRegisterStore();
    const seams = memoryPlanRegisterSeams({ store });
    const ordinary = unwrap(await storePlanRegisterPort({ seams }).read({ home }));

    const readOnly = unwrap(await readOnlyStorePlanRegisterPort({ seams }).read({ home }));

    expect(readOnly).toStrictEqual(ordinary);
    expect(readOnly.revision).toBe(1);
  });

  it("refuses every write before a seam runs, leaving the row, the seat passes and the projections untouched", async () => {
    const home = homeWithLegacyFile();
    const store = memoryPlanRegisterStore();
    const seams = memoryPlanRegisterSeams({ store });
    unwrap(await storePlanRegisterPort({ seams }).read({ home }));
    const opened = store.opened;
    const accountsJson = stateHomePaths({ home }).claudeAccountsJson;

    const write = await readOnlyStorePlanRegisterPort({ seams }).write({
      home,
      mutation: { alias: "codex-one", kind: "pin", provider: "codex" },
      nowIso: "2026-11-27T12:00:00.000Z",
    });

    expect(unwrapErr(write).code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(store.opened).toBe(opened);
    expect([...store.rows.values()].map((row) => row.revision)).toStrictEqual([1]);
    expect(existsSync(accountsJson)).toBe(false);
  });
});
