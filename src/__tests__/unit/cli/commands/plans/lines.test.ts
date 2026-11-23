/**
 * What the `plans` verbs print, asserted directly on the pure renderer.
 *
 * `run.test.ts` drives these through the verb; this file pins the properties that are about the TABLE itself
 * — column alignment measured off the rows, and the empty case — which a verb-level test would only ever
 * reach incidentally.
 */
import { describe, expect, it } from "vitest";

import {
  codexPaidThrough,
  planChangeLines,
  planListLines,
  planValidateLines,
} from "../../../../../cli/commands/plans/lines.js";
import { CodexSubscriptionDatesErrors } from "../../../../../codex/subscriptionDatesErrors.js";
import { err, ok } from "../../../../../lib/result.js";
import { DEFAULT_THRESHOLDS } from "../../../../../plans/thresholds.js";
import type { PlanRegisterSnapshot, RegisteredPlan } from "../../../../../plans/types.js";

const NOW = "2026-09-22T11:00:00.000Z";

/** One registered row, with only the fields a case cares about spelled. */
const row = (over: Partial<RegisteredPlan> = {}): RegisteredPlan => ({
  alias: "plan-one",
  allowance: { kind: "weekly-window" },
  provider: "claude",
  usageLimitPercent: 100,
  storeDir: "/s/one",
  ...over,
});

/** A snapshot carrying the given rows. */
const snapshotOf = ({
  diagnostics = [],
  document = {},
  plans,
  source = "registered",
  thresholds = DEFAULT_THRESHOLDS,
}: {
  diagnostics?: PlanRegisterSnapshot["diagnostics"];
  document?: Readonly<Record<string, unknown>>;
  plans: readonly RegisteredPlan[];
  source?: PlanRegisterSnapshot["source"];
  thresholds?: PlanRegisterSnapshot["thresholds"];
}): PlanRegisterSnapshot => ({
  diagnostics,
  document: { ...document, rows: plans.map((plan) => ({ ...plan })), version: 1 },
  plans,
  revision: null,
  source,
  thresholds,
});

describe("planListLines", () => {
  it("measures both columns off the rows being printed, so the store column lines up, and ends each on its lapse", () => {
    const lines = planListLines({
      paidThroughReadings: [],
      providers: [],
      snapshot: snapshotOf({
        plans: [
          row({ email: "a@example.com", lapsesAtIso: "2026-11-17T00:00:00+11:00" }),
          row({ alias: "codex-ambient", provider: "codex", storeDir: "/x/ambient" }),
        ],
      }),
    });
    const storeColumn = lines.map((line) => line.indexOf("/"));
    expect(storeColumn[0]).toBe(storeColumn[1]);
    expect(lines).toStrictEqual([
      "plan-one       Claude · CACHED a@example.com          weekly-window limit 100%  /s/one · lapses 2026-11-17T00:00:00+11:00",
      "codex-ambient  Codex · UNMAPPED                       weekly-window limit 100%  /x/ambient · lapse UNRECORDED",
    ]);
  });

  it("measures the usage-limit column too, and says a Claude monthly-spend limit is judged off `claude spend`", () => {
    const lines = planListLines({
      paidThroughReadings: [],
      providers: [],
      snapshot: snapshotOf({
        plans: [
          row({ email: "a@example.com", usageLimitPercent: 30 }),
          row({ alias: "plan-two", allowance: { kind: "monthly-spend" }, storeDir: "/s/two", usageLimitPercent: 50 }),
        ],
      }),
    });
    expect(lines).toStrictEqual([
      "plan-one  Claude · CACHED a@example.com          weekly-window limit 30%                   /s/one · lapse UNRECORDED",
      "plan-two  Claude · UNMAPPED                      monthly-spend limit 50% via claude spend  /s/two · lapse UNRECORDED",
    ]);
  });

  it("prints both state words for a row that is pinned AND paused", () => {
    const lines = planListLines({
      paidThroughReadings: [],
      providers: [],
      snapshot: snapshotOf({
        plans: [row({ email: "a@example.com", paused: { reason: "spent", sinceIso: NOW }, pinned: true })],
      }),
    });
    expect(lines[0]).toBe(
      "plan-one  Claude · CACHED a@example.com  pinned+PAUSED  weekly-window limit 100%  /s/one · lapse UNRECORDED",
    );
  });

  it("does not print a Codex row's legacy pin, which decides nothing", () => {
    const lines = planListLines({
      paidThroughReadings: [],
      providers: [],
      snapshot: snapshotOf({
        plans: [
          row({ alias: "codex-ambient", email: "x@example.com", pinned: true, provider: "codex", storeDir: "/x" }),
        ],
      }),
    });
    expect(lines[0]).toBe(
      "codex-ambient  Codex · CACHED x@example.com          weekly-window limit 100%  /x · lapse UNRECORDED",
    );
  });

  it("prints a Codex row's provider-stated paid-through date, and never looks a Claude alias up", () => {
    const stated = {
      kind: "stated",
      lastCheckedIso: "2026-01-20T10:11:12+00:00",
      paidThroughIso: "2026-02-02T03:04:05+00:00",
    } as const;
    const lines = planListLines({
      paidThroughReadings: [
        { alias: "codex-ambient", paidThrough: stated },
        { alias: "plan-one", paidThrough: stated },
      ],
      providers: [],
      snapshot: snapshotOf({
        plans: [
          row({ email: "a@example.com" }),
          row({ alias: "codex-ambient", email: "x@example.com", provider: "codex", storeDir: "/x" }),
        ],
      }),
    });

    expect(lines).toStrictEqual([
      "plan-one       Claude · CACHED a@example.com          weekly-window limit 100%  /s/one · lapse UNRECORDED",
      "codex-ambient  Codex · CACHED x@example.com           weekly-window limit 100%  /x · paid through 2026-02-02T03:04:05+00:00 (provider-stated, checked 2026-01-20T10:11:12+00:00)",
    ]);
  });

  it("says a register with no destinations is empty, rather than printing a bare table header", () => {
    expect(
      planListLines({ paidThroughReadings: [], providers: [], snapshot: snapshotOf({ plans: [] }) }),
    ).toStrictEqual(["plans list: this install has no registered destinations"]);
  });

  it("still reports the diagnostics when there is nothing to tabulate", () => {
    const lines = planListLines({
      paidThroughReadings: [],
      providers: [],
      snapshot: snapshotOf({ diagnostics: [{ code: "UNKNOWN_CAPACITY", message: "nothing measured" }], plans: [] }),
    });
    expect(lines[1]).toBe("note [UNKNOWN_CAPACITY]: nothing measured");
  });

  it("opens with each named provider's thresholds block, every field marked (default) on a bare register", () => {
    const lines = planListLines({ paidThroughReadings: [], providers: ["codex"], snapshot: snapshotOf({ plans: [] }) });

    expect(lines).toStrictEqual([
      "codex thresholds:",
      "  alert-at-percent  75% (default)",
      "  pause-at-percent  99% (default)",
      "plans list: this install has no registered destinations",
    ]);
  });

  it("marks a field the register names (set) with the stored value, and leaves its sibling (default)", () => {
    const lines = planListLines({
      paidThroughReadings: [],
      providers: ["codex"],
      snapshot: snapshotOf({
        document: { thresholds: { codex: { pauseAtPercent: 90 } } },
        plans: [],
        thresholds: { ...DEFAULT_THRESHOLDS, codex: { alertAtPercent: 75, pauseAtPercent: 90 } },
      }),
    });

    expect(lines.slice(0, 3)).toStrictEqual([
      "codex thresholds:",
      "  alert-at-percent  75% (default)",
      "  pause-at-percent  90% (set)",
    ]);
  });
});

describe("codexPaidThrough", () => {
  const path = "/x/auth.json";

  it("carries a stated reading's paid-through and checked instants", () => {
    const read = ok({
      lastCheckedIso: "2026-01-20T10:11:12+00:00",
      paidThroughIso: "2026-02-02T03:04:05+00:00",
    });

    expect(codexPaidThrough({ read })).toStrictEqual({
      kind: "stated",
      lastCheckedIso: "2026-01-20T10:11:12+00:00",
      paidThroughIso: "2026-02-02T03:04:05+00:00",
    });
  });

  it.each([
    [CodexSubscriptionDatesErrors.authUnreadable({ path }), "no sign-in file"],
    [CodexSubscriptionDatesErrors.authInvalid({ path }), "sign-in file malformed"],
    [CodexSubscriptionDatesErrors.idTokenInvalid({ path }), "sign-in token undecodable"],
    [CodexSubscriptionDatesErrors.claimsAbsent({ path }), "sign-in states no subscription"],
    [CodexSubscriptionDatesErrors.claimsInvalid({ path }), "subscription date malformed"],
  ])("words %o as a short reason naming no path", (error, reason) => {
    expect(codexPaidThrough({ read: err(error) })).toStrictEqual({ kind: "unread", reason });
  });
});

describe("planValidateLines", () => {
  it("names the count and which picture it came from, then says there is nothing to report", () => {
    expect(planValidateLines({ snapshot: snapshotOf({ plans: [row()], source: "derived" }) })).toStrictEqual([
      "1 destination(s) registered, read from the derived picture",
      "plans validate: nothing to report",
    ]);
  });

  it("replaces the all-clear line with the findings when there are any", () => {
    const lines = planValidateLines({
      snapshot: snapshotOf({
        diagnostics: [{ code: "PROJECTION_DIVERGED", message: "the copy no longer matches" }],
        plans: [row()],
      }),
    });
    expect(lines).toStrictEqual([
      "1 destination(s) registered, read from the registered picture",
      "note [PROJECTION_DIVERGED]: the copy no longer matches",
    ]);
  });
});

describe("planChangeLines", () => {
  it("hands over the sign-in step a newly registered Codex destination still needs", () => {
    const added = row({ alias: "codex-two", provider: "codex", storeDir: "/x/two" });
    const lines = planChangeLines({
      added,
      did: "registered codex/codex-two",
      snapshot: snapshotOf({ plans: [added] }),
    });
    expect(lines).toStrictEqual([
      "plans: registered codex/codex-two — 1 destination(s) now registered",
      "Sign this destination in from Settings → Models in the console, or from your own terminal:\n" +
        "  mkdir -p /x/two && CODEX_HOME=/x/two codex login\n" +
        "Two homes signed into the same account add no capacity.",
    ]);
  });

  it("adds no sign-in step for a Claude destination, whose store the Claude verbs provision", () => {
    const added = row({ alias: "plan-six", storeDir: "/s/six" });
    const lines = planChangeLines({
      added,
      did: "registered claude/plan-six",
      snapshot: snapshotOf({ plans: [added] }),
    });
    expect(lines).toStrictEqual(["plans: registered claude/plan-six — 1 destination(s) now registered"]);
  });

  it("shell-quotes a store directory holding a space, so the sign-in line stays one token", () => {
    const added = row({ alias: "codex-two", provider: "codex", storeDir: "/x/two homes" });
    const lines = planChangeLines({ added, did: "registered", snapshot: snapshotOf({ plans: [added] }) });
    expect(lines[1]).toContain("mkdir -p '/x/two homes' && CODEX_HOME='/x/two homes' codex login");
  });

  it("prints only what changed when the change registered no row", () => {
    expect(
      planChangeLines({ did: "adopted the derived picture", snapshot: snapshotOf({ plans: [row()] }) }),
    ).toStrictEqual(["plans: adopted the derived picture — 1 destination(s) now registered"]);
  });
});
