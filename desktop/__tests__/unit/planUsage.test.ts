/**
 * The menu bar's reading of the console's `plan-usage` answer: the real document `plans usage --json` printed, the
 * register holding no plan, and every way the answer is refused whole rather than drawn in part.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import { parsePlanUsageLiveResult } from "../../src/planUsage";

const NOW = "2026-11-06T18:31:48.183Z";

/** Two rows in the shape `plans usage --json` printed, the addresses swapped for synthetic ones. */
const PAYLOAD = {
  observedAtIso: NOW,
  rows: [
    {
      alias: "plan-one",
      allowance: "weekly-window",
      email: "owner@acme.example",
      modelHost: "claude",
      signIn: { kind: "ok", observedAtIso: "2026-11-06T18:31:18.301Z", source: "claude-gauge-probe" },
      usage: {
        kind: "weekly",
        windows: [
          {
            kind: "measured",
            label: "week",
            observedAtIso: "2026-11-06T18:31:18.301Z",
            resetAtIso: "2026-11-08T03:00:00.000Z",
            source: "claude-gauge-snapshot",
            usedPercent: 77,
          },
          {
            kind: "no-reading",
            label: "fable-week",
            observedAtIso: null,
            reason: "the last gauge carried no reading of this window",
            source: "claude-gauge-snapshot",
          },
        ],
      },
      usageLimitPercent: 100,
    },
    {
      alias: "codex-one",
      allowance: "weekly-window",
      email: null,
      modelHost: "codex",
      signIn: {
        kind: "needs-sign-in",
        observedAtIso: null,
        reason: "auth.json is absent",
        source: "codex-store-files",
      },
      usage: { kind: "paused", reason: "the subscription lapsed", sinceIso: NOW },
      usageLimitPercent: 100,
    },
  ],
};

/** The envelope the route wraps a reading in. */
const answered = ({ payload }: { payload: unknown }): unknown => ({
  observedAtIso: NOW,
  ok: true,
  payload,
  stampedByRoute: false,
});

describe("parsePlanUsageLiveResult", () => {
  it("reads every field the menu draws off the verb's real document", () => {
    expect(unwrap(parsePlanUsageLiveResult({ value: answered({ payload: PAYLOAD }) }))).toEqual({
      kind: "report",
      observedAtIso: NOW,
      rows: [
        {
          alias: "plan-one",
          modelHost: "claude",
          signIn: { kind: "ok" },
          usage: {
            kind: "weekly",
            windows: [
              {
                kind: "measured",
                label: "week",
                observedAtIso: "2026-11-06T18:31:18.301Z",
                resetAtIso: "2026-11-08T03:00:00.000Z",
                usedPercent: 77,
              },
              { kind: "no-reading", label: "fable-week", reason: "the last gauge carried no reading of this window" },
            ],
          },
        },
        {
          alias: "codex-one",
          modelHost: "codex",
          signIn: { kind: "needs-sign-in", reason: "auth.json is absent" },
          usage: { kind: "paused", reason: "the subscription lapsed" },
        },
      ],
    });
  });

  it("reads the register holding no plan as an answer", () => {
    const empty = answered({ payload: { code: "NO_PLANS", kind: "expected-empty", why: "no destination" } });

    expect(unwrap(parsePlanUsageLiveResult({ value: empty }))).toEqual({ kind: "none-registered" });
  });

  it("carries the console's own sentence when it could not run the verb", () => {
    const failed = {
      notMeasured: "slopweaver plans usage --json timed out after 20000ms",
      observedAtIso: NOW,
      ok: false,
    };

    expect(unwrapErr(parsePlanUsageLiveResult({ value: failed }))).toBe(
      "slopweaver plans usage --json timed out after 20000ms",
    );
  });

  it("refuses the whole reading when one row is malformed, naming the row", () => {
    const broken = { ...PAYLOAD, rows: [PAYLOAD.rows[0], { ...PAYLOAD.rows[1], modelHost: "gemini" }] };

    expect(unwrapErr(parsePlanUsageLiveResult({ value: answered({ payload: broken }) }))).toBe(
      "the reading is malformed: row 2",
    );
  });

  it("refuses a measured window whose percentage is missing, never reading it as 0%", () => {
    const window = { kind: "measured", label: "week", observedAtIso: NOW, resetAtIso: null };
    const row = { ...PAYLOAD.rows[0], usage: { kind: "weekly", windows: [window] } };

    expect(
      unwrapErr(parsePlanUsageLiveResult({ value: answered({ payload: { observedAtIso: NOW, rows: [row] } }) })),
    ).toBe("the reading is malformed: row 1");
  });

  it("refuses an answer that is not the route's envelope", () => {
    expect(unwrapErr(parsePlanUsageLiveResult({ value: PAYLOAD }))).toBe("the console's answer carries no reading");
    expect(unwrapErr(parsePlanUsageLiveResult({ value: "nope" }))).toBe("the console's answer is not a document");
  });
});
