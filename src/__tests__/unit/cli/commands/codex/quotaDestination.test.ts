/**
 * {@link codexQuotaDestination} — which destination `codex quota` acts on. Only a registered Codex row is one: a
 * named plan is a register read, so a store outage stays that read's error rather than turning into the
 * unknown-alias answer, and an alias no row carries is never substituted with the ambient home.
 *
 * The four cases that resolved an UNNAMED `--plan` to the ambient home went with that default.
 *
 * deleted-with-code: ambientCodexDestination
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { codexQuotaDestination } from "../../../../../cli/commands/codex/quotaRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";

describe("codexQuotaDestination", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "codex-quota-destination-"));
    writeFileSync(
      stateHomePaths({ home }).plansJson,
      JSON.stringify({ rows: [{ alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" }], version: 1 }),
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("resolves a named plan to its own home", async () => {
    expect(
      unwrap(await codexQuotaDestination({ home, port: memoryPlanRegisterPort(), requested: "codex-one" })),
    ).toStrictEqual({ alias: "codex-one", codexHome: "/stores/codex-one" });
  });

  it("answers ok(undefined) for a named plan no Codex row carries", async () => {
    expect(unwrap(await codexQuotaDestination({ home, port: memoryPlanRegisterPort(), requested: "codex-nine" }))).toBe(
      undefined,
    );
  });

  it("answers ok(undefined) for the old ambient alias, which no registered row carries here", async () => {
    expect(
      unwrap(await codexQuotaDestination({ home, port: memoryPlanRegisterPort(), requested: "codex-ambient" })),
    ).toBe(undefined);
  });

  it("refuses a named plan with the store's outage, never the unknown-alias answer", async () => {
    const error = unwrapErr(
      await codexQuotaDestination({ home, port: unavailablePlanRegisterPort(), requested: "codex-one" }),
    );
    expect(error.code).toBe("REGISTER_STORE_UNAVAILABLE");
  });
});
