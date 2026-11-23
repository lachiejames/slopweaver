/**
 * `queue defer` and `queue deferred`: a press lands in the ledger the page orders by, a restore takes it back out,
 * and a card the owner's Queue does not draw is refused before anything is written.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  parseDeferArgs,
  parseDeferredArgs,
  runQueueDefer,
  runQueueDeferred,
} from "../../../../../cli/commands/queue/deferRun.js";
import { QUEUE_DEFER_USAGE, QUEUE_DEFERRED_USAGE } from "../../../../../cli/commands/queue/deferUsage.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { standingDeferrals } from "../../../../../queueDefer/cardDeferral.js";
import { readCardDeferrals } from "../../../../../queueDefer/cardDeferralStore.js";

describe("queue defer and queue deferred", () => {
  let home = "";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "queue-defer-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** The argv `bin/slopweaver queue <verb> …` hands the runner. */
  const argv = ({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] => [
    "node",
    "slopweaver",
    "queue",
    verb,
    ...rest,
    "--home",
    home,
  ];

  it("records a press as a standing deferral, and a restore takes it back out", () => {
    const deferred = runQueueDefer(
      argv({ rest: ["--kind", "ask", "--id", "policy-approvals", "--json"], verb: "defer" }),
    );
    const standing = standingDeferrals({ rows: unwrap(readCardDeferrals({ home })).rows }).map((one) => one.cardKey);
    const restored = runQueueDefer(
      argv({ rest: ["--kind", "ask", "--id", "policy-approvals", "--restore"], verb: "defer" }),
    );
    const after = standingDeferrals({ rows: unwrap(readCardDeferrals({ home })).rows });
    expect([deferred, standing, restored, after]).toEqual([EXIT_OK, ["ask:policy-approvals"], EXIT_OK, []]);
  });

  it("records the press as the terminal unless a session is named", () => {
    runQueueDefer(argv({ rest: ["--kind", "hand", "--id", "datadog-key"], verb: "defer" }));
    runQueueDefer(
      argv({ rest: ["--kind", "pr", "--id", "acme.widgets.1885", "--by-session", "work-console"], verb: "defer" }),
    );
    expect(unwrap(readCardDeferrals({ home })).rows.map((row) => row.bySession)).toEqual(["terminal", "work-console"]);
  });

  it("refuses an act card before writing anything", () => {
    const exit = runQueueDefer(argv({ rest: ["--kind", "act", "--id", "x", "--json"], verb: "defer" }));
    expect([exit, unwrap(readCardDeferrals({ home })).rows]).toEqual([EXIT_USAGE, []]);
  });

  it("reads an empty ledger cleanly", () => {
    expect(runQueueDeferred(argv({ rest: ["--json"], verb: "deferred" }))).toBe(EXIT_OK);
  });
});

describe("parseDeferArgs", () => {
  it("names both missing flags at once", () => {
    expect(unwrapErr(parseDeferArgs({ rest: [] }))).toEqual([
      "queue defer needs --kind <hand|ask|draft|post|review|import|pr>, the register the card comes from",
      "queue defer needs --id <id>, the card's id within that register",
    ]);
  });

  it("reads every flag the usage line names", () => {
    const parsed = unwrap(
      parseDeferArgs({
        rest: ["--kind", "ask", "--id", "x", "--restore", "--by-session", "s", "--json", "--home", "/h"],
      }),
    );
    expect(parsed).toEqual({ bySession: "s", home: "/h", id: "x", json: true, kind: "ask", restore: true });
    expect(QUEUE_DEFER_USAGE).toContain("--by-session <s>");
  });
});

describe("parseDeferredArgs", () => {
  it("reads --json and --home", () => {
    expect(unwrap(parseDeferredArgs({ rest: ["--json", "--home", "/h"] }))).toEqual({ home: "/h", json: true });
    expect(QUEUE_DEFERRED_USAGE).toBe("usage: slopweaver queue deferred [--json] [--home <dir>]");
  });
});
