/**
 * `codex quota show --routed` — the call widget's Plan left read, routed by the Talk call's own decision rather
 * than the ambient store. {@link routedFlagRefusal} is the argv half; the verb cases prove `--routed` reaches the
 * route (a sandbox home has no store, so the route's register read fails) and that its refusals precede it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ROUTED_QUOTA_DEADLINE_MS,
  routedFlagRefusal,
  routedQuotaDeadlineAtMs,
  runCodexQuota,
} from "../../../../../cli/commands/codex/quotaRun.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** The argv prefix `runCodexQuota` slices off: `[node, cli, codex, quota]`. */
const PREFIX = ["node", "slopweaver", "codex", "quota"];

describe("routedFlagRefusal", () => {
  it("lets every argv without --routed through, whatever else it carries", () => {
    expect(routedFlagRefusal({ plan: "codex-one", routed: false, sub: "clear" })).toBe(undefined);
  });

  it("lets show --routed through", () => {
    expect(routedFlagRefusal({ plan: undefined, routed: true, sub: "show" })).toBe(undefined);
  });

  it("refuses --routed beside --plan", () => {
    expect(routedFlagRefusal({ plan: "codex-one", routed: true, sub: "show" })).toBe(
      "--routed names the row a Talk call would spend, so it cannot be given beside --plan",
    );
  });

  it("refuses --routed on clear", () => {
    expect(routedFlagRefusal({ plan: undefined, routed: true, sub: "clear" })).toBe(
      "--routed is for `show` only; `clear` acts on one named --plan",
    );
  });
});

describe("routedQuotaDeadlineAtMs", () => {
  it("bounds a routed read to one deadline from the verb's start, and leaves a plain read unbounded", () => {
    expect([
      routedQuotaDeadlineAtMs({ nowMs: 1_000, routed: true }),
      routedQuotaDeadlineAtMs({ nowMs: 1_000, routed: false }),
    ]).toStrictEqual([1_000 + ROUTED_QUOTA_DEADLINE_MS, undefined]);
  });

  it("ends the reads 30s before the console kills the poll at 90s", () => {
    expect(ROUTED_QUOTA_DEADLINE_MS).toBe(60_000);
  });
});

describe("runCodexQuota --routed", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "codex-quota-routed-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses --routed with --plan or on clear as usage, and routes show --routed through the register", async () => {
    const codes = [
      await runCodexQuota([...PREFIX, "show", "--routed", "--plan", "codex-one", "--home", home]),
      await runCodexQuota([...PREFIX, "clear", "--routed", "--home", home]),
      await runCodexQuota([...PREFIX, "show", "--routed", "--home", home]),
    ];
    expect(codes).toStrictEqual([EXIT_USAGE, EXIT_USAGE, EXIT_ERROR]);
  });
});

describe("runCodexQuota with no --plan", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "codex-quota-bare-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a bare show and a bare clear as usage, never defaulting to a Codex login found on the machine", async () => {
    const codes = [
      await runCodexQuota([...PREFIX, "show", "--home", home]),
      await runCodexQuota([...PREFIX, "clear", "--home", home]),
    ];
    expect(codes).toStrictEqual([EXIT_USAGE, EXIT_USAGE]);
  });
});
