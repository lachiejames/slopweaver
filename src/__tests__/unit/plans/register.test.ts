import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { describeCause, type PlanRegisterError, PlanRegisterErrors } from "../../../plans/errors.js";
import { derivePlanRegister, parsePlanRegister, pinnedPlanFor, plansForProvider } from "../../../plans/register.js";
import type { PlanRegisterSnapshot } from "../../../plans/types.js";

/** The five Claude rows this install actually carries, aliases and paths only. */
const LEGACY_CLAUDE_ROWS: readonly Readonly<Record<string, unknown>>[] = [
  { alias: "plan-one", pinned: null, storeDir: "/home/.slopweaver/claude-accounts/plan-one" },
  { alias: "plan-two", pinned: null, storeDir: "/home/.slopweaver/claude-accounts/plan-two" },
  { alias: "plan-three", pinned: null, storeDir: "/home/.slopweaver/claude-accounts/plan-three" },
  { alias: "plan-four", pinned: null, storeDir: "/home/.slopweaver/claude-accounts/plan-four" },
  { alias: "plan-five", pinned: null, storeDir: "/home/.slopweaver/claude-accounts/plan-five" },
];

/**
 * The problem list off a REGISTER_INVALID error, so no assertion carries a conditional
 * (`.claude/rules/testing.md`). The caller asserts the code first; this narrows outside the `expect`.
 */
const invalidProblems = ({ error }: { error: PlanRegisterError }): readonly string[] =>
  error.code === "REGISTER_INVALID" ? error.problems : ["NOT INVALID — this error carries no problem list"];

/** What every row naming no usage limit decodes to: the whole week of a subscription. */
const WHOLE_WEEK = { allowance: { kind: "weekly-window" }, usageLimitPercent: 100 } as const;

const registered = ({ rows }: { rows: readonly Readonly<Record<string, unknown>>[] }): PlanRegisterSnapshot =>
  unwrap(parsePlanRegister({ value: { rows, version: 1 } }));

describe("parsePlanRegister", () => {
  it("accepts a register holding only Codex rows", () => {
    const snapshot = registered({
      rows: [{ alias: "codex-work", pinned: true, provider: "codex", storeDir: "/homes/work" }],
    });
    expect(snapshot.source).toBe("registered");
    expect(snapshot.plans).toStrictEqual([
      { alias: "codex-work", pinned: true, provider: "codex", storeDir: "/homes/work", ...WHOLE_WEEK },
    ]);
    expect(plansForProvider({ plans: snapshot.plans, provider: "claude" })).toStrictEqual([]);
  });

  it("reads a row naming no usage limit as the whole week, and leaves the raw row as it was", () => {
    const row = { alias: "plan-one", provider: "claude", storeDir: "/s/one" };
    const snapshot = registered({ rows: [row] });
    expect(snapshot.plans).toStrictEqual([{ ...row, ...WHOLE_WEEK }]);
    expect(snapshot.document.rows).toStrictEqual([row]);
  });

  it("reads an explicit weekly 30 and a monthly 40 exactly", () => {
    const snapshot = registered({
      rows: [
        { alias: "a", allowance: { kind: "weekly-window" }, provider: "claude", storeDir: "/a", usageLimitPercent: 30 },
        { alias: "b", allowance: { kind: "monthly-spend" }, provider: "codex", storeDir: "/b", usageLimitPercent: 40 },
      ],
    });
    expect(snapshot.plans.map((plan) => [plan.alias, plan.allowance.kind, plan.usageLimitPercent])).toStrictEqual([
      ["a", "weekly-window", 30],
      ["b", "monthly-spend", 40],
    ]);
  });

  it.each([0, 25, 110, 30.5, "30"])("refuses a usage limit of %s, naming the accepted steps", (usageLimitPercent) => {
    const error = unwrapErr(
      parsePlanRegister({
        value: { rows: [{ alias: "a", provider: "claude", storeDir: "/a", usageLimitPercent }], version: 1 },
      }),
    );
    expect(error.code).toBe("REGISTER_INVALID");
    expect(invalidProblems({ error })).toStrictEqual([
      "row 1's `usageLimitPercent`, when present, must be an integer from 10 through 100 in increments of 10",
    ]);
  });

  it.each([{ kind: "daily" }, "weekly-window", {}])("refuses an allowance of %j", (allowance) => {
    const error = unwrapErr(
      parsePlanRegister({
        value: { rows: [{ alias: "a", allowance, provider: "claude", storeDir: "/a" }], version: 1 },
      }),
    );
    expect(error.code).toBe("REGISTER_INVALID");
    expect(invalidProblems({ error })).toStrictEqual([
      "row 1's `allowance`, when present, must be an object with a `kind` of `weekly-window` or `monthly-spend`",
    ]);
  });

  it("refuses a version it does not read, naming the version it does", () => {
    const error = unwrapErr(parsePlanRegister({ value: { rows: [], version: 2 } }));
    expect(error.code).toBe("REGISTER_INVALID");
    expect(error.message).toContain("declares version 2");
    expect(error.message).toContain("reads version 1 only");
  });

  it("refuses a register that is not an object", () => {
    const error = unwrapErr(parsePlanRegister({ value: [] }));
    expect(error.code).toBe("REGISTER_INVALID");
    expect(error.message).toContain("the register is not an object");
  });

  it("refuses rows that is not an array", () => {
    const error = unwrapErr(parsePlanRegister({ value: { rows: {}, version: 1 } }));
    expect(error.message).toContain("the register's `rows` is not an array");
  });

  it("reports every row problem at once, pointing at the offending row", () => {
    const error = unwrapErr(
      parsePlanRegister({
        value: {
          rows: [
            { alias: "Plan_One", provider: "anthropic", storeDir: "" },
            { alias: "ok", email: "nope", provider: "codex", storeDir: "/a" },
            { alias: "two", email: "a@example.invalid\r\nPLAN x: forged", provider: "claude", storeDir: "/b" },
          ],
          version: 1,
        },
      }),
    );
    expect(error.code).toBe("REGISTER_INVALID");
    expect(invalidProblems({ error })).toStrictEqual([
      "row 1 needs a `provider` of `claude` or `codex`",
      "row 1 needs an `alias` of lowercase letters, digits and hyphens",
      "row 1 needs a `storeDir` naming the directory its provider's CLI is signed into",
      "row 2's `email`, when present, must be the one-line address its store's account is called",
      "row 3's `email`, when present, must be the one-line address its store's account is called",
    ]);
  });

  it("accepts an empty register — a Claude rotation floor is not this parser's rule", () => {
    const snapshot = registered({ rows: [] });
    expect(snapshot.plans).toStrictEqual([]);
    expect(snapshot.source).toBe("registered");
  });

  it("refuses an alias past the length cap", () => {
    const error = unwrapErr(
      parsePlanRegister({
        value: { rows: [{ alias: "a".repeat(33), provider: "codex", storeDir: "/a" }], version: 1 },
      }),
    );
    expect(error.message).toContain("row 1's alias is longer than 32 characters");
  });

  it("scopes duplicate aliases and store paths to one provider", () => {
    const shared = { alias: "shared", storeDir: "/same" };
    const across = registered({
      rows: [
        { ...shared, provider: "claude" },
        { ...shared, provider: "codex" },
      ],
    });
    expect(across.plans.map((plan) => plan.provider)).toStrictEqual(["claude", "codex"]);
    const within = unwrapErr(
      parsePlanRegister({
        value: {
          rows: [
            { alias: "a", provider: "codex", storeDir: "/same" },
            { alias: "a", provider: "codex", storeDir: "/same" },
          ],
          version: 1,
        },
      }),
    );
    expect(invalidProblems({ error: within })).toStrictEqual([
      "two codex plans share the same alias `a`",
      "two codex plans share the same storeDir `/same`",
    ]);
  });

  it("refuses a second spelling of a monthly-spend plan's store", () => {
    const spelled = unwrapErr(
      parsePlanRegister({
        value: {
          rows: [
            { alias: "monthly", allowance: { kind: "monthly-spend" }, provider: "claude", storeDir: "/tmp/./shared" },
            { alias: "weekly", provider: "claude", storeDir: "/tmp/shared//" },
          ],
          version: 1,
        },
      }),
    );
    expect(invalidProblems({ error: spelled })).toStrictEqual([
      "the monthly-spend claude plan `monthly` and the claude plan `weekly` name one store `/tmp/shared`; a " +
        "monthly-spend store is never probed, so no other plan may name it",
    ]);
  });

  it("refuses a Codex plan naming a Claude monthly-spend plan's store", () => {
    const across = unwrapErr(
      parsePlanRegister({
        value: {
          rows: [
            { alias: "monthly", allowance: { kind: "monthly-spend" }, provider: "claude", storeDir: "/tmp/shared" },
            { alias: "weekly", provider: "codex", storeDir: "/tmp/shared" },
          ],
          version: 1,
        },
      }),
    );
    expect(invalidProblems({ error: across })).toStrictEqual([
      "the monthly-spend claude plan `monthly` and the codex plan `weekly` name one store `/tmp/shared`; a " +
        "monthly-spend store is never probed, so no other plan may name it",
    ]);
  });

  it("refuses a relative store beside a monthly-spend plan, and keeps one when there is none", () => {
    const relative = unwrapErr(
      parsePlanRegister({
        value: {
          rows: [
            { alias: "monthly", allowance: { kind: "monthly-spend" }, provider: "codex", storeDir: "." },
            { alias: "weekly", provider: "codex", storeDir: "/tmp/shared" },
          ],
          version: 1,
        },
      }),
    );
    expect(invalidProblems({ error: relative })).toStrictEqual([
      "the codex plan `monthly` names a relative store `.` beside a monthly-spend plan; its directory depends on " +
        "where the reader runs, so it cannot be shown apart from a store that is never probed",
    ]);
    const weeklyOnly = registered({ rows: [{ alias: "weekly", provider: "codex", storeDir: "relative/store" }] });
    expect(weeklyOnly.plans.map((plan) => plan.storeDir)).toStrictEqual(["relative/store"]);
  });

  it("still accepts weekly plans spelled apart or shared across providers, as the base did", () => {
    const legacy = registered({
      rows: [
        { alias: "plan-one", provider: "claude", storeDir: "/tmp/shared" },
        { alias: "plan-two", provider: "claude", storeDir: "/tmp/shared/" },
        { alias: "codex-weekly", provider: "codex", storeDir: "/tmp/shared" },
        { alias: "codex-monthly", allowance: { kind: "monthly-spend" }, provider: "codex", storeDir: "/tmp/own" },
      ],
    });
    expect(legacy.plans.map((plan) => plan.alias)).toStrictEqual([
      "plan-one",
      "plan-two",
      "codex-weekly",
      "codex-monthly",
    ]);
  });

  it("allows one Claude pin and refuses two", () => {
    const both = registered({
      rows: [
        { alias: "plan-one", pinned: true, provider: "claude", storeDir: "/c1" },
        { alias: "plan-two", provider: "claude", storeDir: "/c2" },
      ],
    });
    expect(pinnedPlanFor({ plans: both.plans, provider: "claude" })?.alias).toBe("plan-one");
    const twoClaude = unwrapErr(
      parsePlanRegister({
        value: {
          rows: [
            { alias: "x", pinned: true, provider: "claude", storeDir: "/c1" },
            { alias: "y", pinned: true, provider: "claude", storeDir: "/c2" },
          ],
          version: 1,
        },
      }),
    );
    expect(invalidProblems({ error: twoClaude })).toStrictEqual([
      "2 claude plans are marked pinned; at most one may be",
    ]);
  });

  it("refuses a pinned Claude row that is also paused", () => {
    const error = unwrapErr(
      parsePlanRegister({
        value: {
          rows: [
            {
              alias: "plan-one",
              paused: { reason: "billing", sinceIso: "2026-09-21T00:00:00.000Z" },
              pinned: true,
              provider: "claude",
              storeDir: "/c1",
            },
          ],
          version: 1,
        },
      }),
    );
    expect(error.message).toContain("the pinned claude plan `plan-one` is paused");
  });

  it("parses legacy Codex pins, two of them and one paused, because a Codex pin decides nothing", () => {
    const legacy = registered({
      rows: [
        {
          alias: "codex-ambient",
          paused: { reason: "billing", sinceIso: "2026-09-21T00:00:00.000Z" },
          pinned: true,
          provider: "codex",
          storeDir: "/x1",
        },
        { alias: "codex-one", pinned: true, provider: "codex", storeDir: "/x2" },
      ],
    });
    expect(legacy.plans.map((plan) => plan.alias)).toStrictEqual(["codex-ambient", "codex-one"]);
  });

  it("refuses a malformed pause rather than ignoring it", () => {
    const error = unwrapErr(
      parsePlanRegister({
        value: {
          rows: [{ alias: "x", paused: { reason: " ", sinceIso: "yesterday" }, provider: "codex", storeDir: "/x" }],
          version: 1,
        },
      }),
    );
    expect(invalidProblems({ error })).toStrictEqual([
      "row 1's `paused.reason` must say what the plan is waiting on",
      "row 1's `paused.sinceIso` must be an ISO-8601 instant",
    ]);
  });

  it("refuses a pause instant Date.parse guesses at, such as a bare zero, while keeping an offset one", () => {
    const pausedAt = ({ sinceIso }: { sinceIso: string }) =>
      parsePlanRegister({
        value: {
          rows: [{ alias: "x", paused: { reason: "billing", sinceIso }, provider: "codex", storeDir: "/x" }],
          version: 1,
        },
      });
    expect(invalidProblems({ error: unwrapErr(pausedAt({ sinceIso: "0" })) })).toStrictEqual([
      "row 1's `paused.sinceIso` must be an ISO-8601 instant",
    ]);
    expect(unwrap(pausedAt({ sinceIso: "2026-09-21T09:00:00+10:00" })).plans.map((plan) => plan.alias)).toStrictEqual([
      "x",
    ]);
  });

  it("refuses a lapse Date.parse guesses at or that is no string, and keeps an offset one exactly as written", () => {
    const lapsingAt = ({ lapsesAtIso }: { lapsesAtIso: unknown }) =>
      parsePlanRegister({
        value: { rows: [{ alias: "x", lapsesAtIso, provider: "claude", storeDir: "/x" }], version: 1 },
      });
    const refusal = ["row 1's `lapsesAtIso`, when present, must be an ISO-8601 instant"];
    expect(invalidProblems({ error: unwrapErr(lapsingAt({ lapsesAtIso: "1763337600" })) })).toStrictEqual(refusal);
    expect(invalidProblems({ error: unwrapErr(lapsingAt({ lapsesAtIso: 1763337600 })) })).toStrictEqual(refusal);
    expect(unwrap(lapsingAt({ lapsesAtIso: "2026-11-17T00:00:00+11:00" })).plans[0]!.lapsesAtIso).toBe(
      "2026-11-17T00:00:00+11:00",
    );
  });
});

describe("derivePlanRegister", () => {
  it("carries the five signed-in Claude rows through unchanged and adds nothing found on the machine", () => {
    const snapshot = unwrap(derivePlanRegister({ claudeRows: LEGACY_CLAUDE_ROWS }));
    expect(snapshot.source).toBe("derived");
    expect(snapshot.plans.map((plan) => `${plan.provider}:${plan.alias}`)).toStrictEqual([
      "claude:plan-one",
      "claude:plan-two",
      "claude:plan-three",
      "claude:plan-four",
      "claude:plan-five",
    ]);
    expect(snapshot.plans.map((plan) => plan.storeDir)).toStrictEqual([
      "/home/.slopweaver/claude-accounts/plan-one",
      "/home/.slopweaver/claude-accounts/plan-two",
      "/home/.slopweaver/claude-accounts/plan-three",
      "/home/.slopweaver/claude-accounts/plan-four",
      "/home/.slopweaver/claude-accounts/plan-five",
    ]);
    expect(pinnedPlanFor({ plans: snapshot.plans, provider: "claude" })).toBe(undefined);
  });

  it("keeps `pinned: null` in the raw rows a legacy file carried", () => {
    const snapshot = unwrap(derivePlanRegister({ claudeRows: LEGACY_CLAUDE_ROWS }));
    expect(snapshot.document.rows[0]).toStrictEqual({
      alias: "plan-one",
      pinned: null,
      provider: "claude",
      storeDir: "/home/.slopweaver/claude-accounts/plan-one",
    });
    expect(snapshot.plans[0]?.pinned).toBe(undefined);
  });

  it("says out loud that the picture was derived rather than read", () => {
    const snapshot = unwrap(derivePlanRegister({ claudeRows: [] }));
    expect(snapshot.diagnostics.map((note) => note.code)).toStrictEqual(["DERIVED_REGISTER"]);
    expect(snapshot.diagnostics[0]?.message).toContain("slopweaver plans adopt");
  });

  it("derives an EMPTY register on an install with no Claude accounts file — never a discovered Codex login", () => {
    const snapshot = unwrap(derivePlanRegister({ claudeRows: [] }));
    expect(snapshot.plans).toStrictEqual([]);
    expect(snapshot.document.rows).toStrictEqual([]);
  });
});

describe("PlanRegisterErrors", () => {
  it("reports a failed projection as a COMMITTED revision rather than as a rollback, naming every path", () => {
    const failure = PlanRegisterErrors.projectionWriteFailed({
      cause: new Error("EACCES: permission denied"),
      committedRevision: 5,
      paths: ["/home/.slopweaver/plans.json", "/home/.slopweaver/claude-accounts/accounts.json"],
    });
    expect(failure.code).toBe("PROJECTION_WRITE_FAILED");
    expect(failure.registerCommitted).toBe(true);
    expect(failure.committedRevision).toBe(5);
    expect(failure.message).toContain("was COMMITTED at revision 5");
    expect(failure.message).toContain("/home/.slopweaver/plans.json, /home/.slopweaver/claude-accounts/accounts.json");
    expect(failure.message).toContain("EACCES: permission denied");
    expect(failure.message).toContain("plans validate --repair-projection");
    expect(failure.message).toContain("This is not a rollback");
  });

  it("says a store outage leaves the fleet UNKNOWN, carrying the store's own reason", () => {
    const failure = PlanRegisterErrors.registerStoreUnavailable({
      doing: "be opened",
      reason: "no database is selected.",
    });
    expect(failure.code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(failure.message).toContain("the store could not be opened");
    expect(failure.message).toContain("refusing rather than seating a session on whatever credential is ambient");
    expect(failure.message).toContain("slopweaver store status");
    expect(failure.message).toContain("The store said: no database is selected.");
  });

  it("names the revision a compare-and-set lost against, and promises nothing was written", () => {
    const failure = PlanRegisterErrors.registerRevisionConflict({ expectedRevision: 3 });
    expect(failure.code).toBe("REGISTER_REVISION_CONFLICT");
    expect(failure.expectedRevision).toBe(3);
    expect(failure.message).toBe(
      "the plan register changed while this change was being prepared (it was read at revision 3), so nothing " +
        "was written; read it again and decide whether the change still applies",
    );
  });

  it("describes a thrown non-Error as an unknown failure rather than stringifying it", () => {
    expect(describeCause({ cause: { url: "postgres://secret@host/db" } })).toBe("unknown failure");
    expect(describeCause({ cause: new Error("connection refused") })).toBe("connection refused");
  });

  it("refuses an unreadable register rather than seating on an ambient credential", () => {
    const failure = PlanRegisterErrors.registerUnreadable({ path: "/home/.slopweaver/plans.json" });
    expect(failure.path).toBe("/home/.slopweaver/plans.json");
    expect(failure.message).toContain("refusing rather than seating a session on whatever credential is ambient");
  });
});
