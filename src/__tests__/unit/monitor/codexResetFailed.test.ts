/**
 * `monitor/codexResetFailed.ts` — the one note the fleet's Codex reset claim raises. The properties that matter to
 * the owner: a claim that refilled its plan says nothing, a claim that did not is ONE note per plan, a claim still waiting
 * on its answer is never a failure, and a failed claim's note goes once the cap it was spent on has ended.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CodexConsumeOutcome, CodexResetJournalRow } from "../../../codex/resetConsume.js";
import type { CodexResetReading } from "../../../codex/resetEvidence.js";
import { evaluateCodexResetFailed } from "../../../monitor/codexResetFailed.js";
import { CODEX_RESET_FAILED } from "../../../monitor/codexResetFailedDefinition.js";
import { readCodexResetFailed } from "../../../monitor/codexResetFailedSource.js";
import { stateHomePaths } from "../../../stateHome.js";

const CLAIMED_AT = "2026-11-05T14:00:00.000Z";
const NOW = "2026-11-05T14:05:00.000Z";
/** The weekly window the claim was spent on resets here, a day after the pass. */
const WEEK_ENDS = "2026-11-06T14:00:00.000Z";

/** A reading of the store: at the bar on a weekly window resetting at {@link WEEK_ENDS}, or below it. */
function reading({ atLimit }: { atLimit: boolean }): CodexResetReading {
  return {
    atLimit,
    pauseAtPercent: 99,
    readAtIso: CLAIMED_AT,
    resetCreditsAvailable: 2,
    windows: [{ label: "weekly", resetAtIso: WEEK_ENDS, slot: "primary", usedPercent: atLimit ? 99 : 0 }],
  };
}

/** A measured claim on `alias` under `key`, answered `outcome` with the store re-read at or below its limit. */
function claim({
  after,
  alias = "plan-a",
  key,
  outcome,
}: {
  after: CodexResetReading | undefined;
  alias?: string;
  key: string;
  outcome: CodexConsumeOutcome | undefined;
}): readonly CodexResetJournalRow[] {
  const intent: CodexResetJournalRow = {
    alias,
    atIso: CLAIMED_AT,
    before: reading({ atLimit: true }),
    idempotencyKey: key,
    kind: "intent",
    v: 1,
  };
  if (outcome === undefined) {
    return [intent];
  }
  const answer: CodexResetJournalRow = {
    alias,
    atIso: CLAIMED_AT,
    idempotencyKey: key,
    kind: "outcome",
    outcome,
    v: 1,
  };
  if (after === undefined) {
    return [intent, answer];
  }
  return [intent, { ...answer, after }];
}

/** Judge `rows` at {@link NOW}, or at `nowIso`. */
function judge({ nowIso = NOW, rows }: { nowIso?: string; rows: readonly CodexResetJournalRow[] }) {
  return evaluateCodexResetFailed({ nowIso, rows: { kind: "read", rows } });
}

describe("evaluateCodexResetFailed", () => {
  it("is clear when the claim refilled its plan, and when nothing has been claimed", () => {
    const refilled = claim({ after: reading({ atLimit: false }), key: "aaaaaaaa-1", outcome: "reset" });
    expect(judge({ rows: refilled })).toEqual({ monitorId: "codex-reset-failed", state: "clear" });
    expect(judge({ rows: [] })).toEqual({ monitorId: "codex-reset-failed", state: "clear" });
  });

  it("raises ONE subject naming every plan whose newest measured claim failed, and why", () => {
    const rows = [
      ...claim({ after: reading({ atLimit: true }), key: "aaaaaaaa-1", outcome: "nothingToReset" }),
      ...claim({ after: reading({ atLimit: true }), alias: "plan-b", key: "bbbbbbbb-1", outcome: "reset" }),
      ...claim({ after: undefined, alias: "plan-c", key: "cccccccc-1", outcome: "alreadyRedeemed" }),
    ];
    const judged = judge({ rows });
    expect(judged.state).toBe("firing");
    const subjects = (judged as { subjects: readonly { id: string; key: string; label: string }[] }).subjects;
    expect(subjects.map((subject) => [subject.id, subject.label])).toEqual([
      [
        "plan-a, plan-b, plan-c",
        [
          `plan-a: claimed at ${CLAIMED_AT}, the provider answered nothingToReset`,
          `plan-b: claimed at ${CLAIMED_AT}, the provider answered reset, but the store still reads at its limit`,
          `plan-c: claimed at ${CLAIMED_AT}, the provider answered alreadyRedeemed, but the store could not be re-read to confirm it`,
        ].join("; "),
      ],
    ]);
    expect(subjects[0]!.key).toMatch(/^failed-[0-9a-f]{12}$/);
  });

  it("re-keys the note when a fresh claim fails, so a new failure is a new note", () => {
    const first = claim({ after: reading({ atLimit: true }), key: "aaaaaaaa-1", outcome: "noCredit" });
    const second = [...first, ...claim({ after: reading({ atLimit: true }), key: "aaaaaaaa-2", outcome: "noCredit" })];
    const keyOf = ({ rows }: { rows: readonly CodexResetJournalRow[] }): string =>
      (judge({ rows }) as { subjects: readonly { key: string }[] }).subjects[0]!.key;
    expect(keyOf({ rows: first })).not.toBe(keyOf({ rows: second }));
  });

  it("clears a plan whose later claim refilled it, and never fires on a claim still waiting on its answer", () => {
    const rows = [
      ...claim({ after: reading({ atLimit: true }), key: "aaaaaaaa-1", outcome: "noCredit" }),
      ...claim({ after: reading({ atLimit: false }), key: "aaaaaaaa-2", outcome: "reset" }),
      ...claim({ after: undefined, alias: "plan-b", key: "bbbbbbbb-1", outcome: undefined }),
    ];
    expect(judge({ rows }).state).toBe("clear");
  });

  it("keeps a failed claim's note while a newer attempt on the same plan still waits on its answer", () => {
    const rows = [
      ...claim({ after: reading({ atLimit: true }), key: "aaaaaaaa-1", outcome: "noCredit" }),
      ...claim({ after: undefined, key: "aaaaaaaa-2", outcome: undefined }),
    ];
    const judged = judge({ rows });
    expect(judged.state).toBe("firing");
    const subjects = (judged as { subjects: readonly { id: string; label: string }[] }).subjects;
    expect(subjects.map((subject) => subject.label)).toEqual([
      `plan-a: claimed at ${CLAIMED_AT}, the provider answered noCredit`,
    ]);
  });

  it("keeps a failed claim's note when a newer attempt was closed without sending", () => {
    const closed: CodexResetJournalRow = {
      alias: "plan-a",
      atIso: CLAIMED_AT,
      idempotencyKey: "aaaaaaaa-2",
      kind: "closed",
      reason: "the store holds no reset",
      v: 1,
    };
    const rows = [
      ...claim({ after: reading({ atLimit: true }), key: "aaaaaaaa-1", outcome: "noCredit" }),
      ...claim({ after: undefined, key: "aaaaaaaa-2", outcome: undefined }),
      closed,
    ];
    expect(judge({ rows }).state).toBe("firing");
  });

  it("lets a failed claim's note go once the window it was spent on has reset, and a day has passed since it failed", () => {
    const rows = claim({ after: reading({ atLimit: true }), key: "aaaaaaaa-1", outcome: "nothingToReset" });
    expect([
      judge({ nowIso: "2026-11-06T13:59:59.000Z", rows }).state,
      judge({ nowIso: WEEK_ENDS, rows }).state,
    ]).toEqual(["firing", "clear"]);
  });

  it("still raises a claim that failed a second before its window reset by itself, on the pass straight after", () => {
    const [intent, answer] = claim({ after: reading({ atLimit: true }), key: "aaaaaaaa-1", outcome: "noCredit" });
    const window = {
      label: "weekly",
      resetAtIso: "2026-11-05T14:00:01.000Z",
      slot: "primary",
      usedPercent: 99,
    } as const;
    const rows = [{ ...intent!, before: { ...reading({ atLimit: true }), windows: [window] } }, answer!];
    expect(judge({ nowIso: "2026-11-05T14:00:02.000Z", rows }).state).toBe("firing");
  });

  it("times the note off the routing window the claim was for, never another window at 99% or one past 100%", () => {
    const [intent, answer] = claim({ after: reading({ atLimit: true }), key: "aaaaaaaa-1", outcome: "noCredit" });
    const other = {
      label: "other",
      resetAtIso: "2026-12-01T00:00:00.000Z",
      slot: "secondary",
      usedPercent: 99,
    } as const;
    const unbelievable = { ...other, label: "weekly", usedPercent: 101 } as const;
    const before = reading({ atLimit: true });
    const rows = [{ ...intent!, before: { ...before, windows: [...before.windows, other, unbelievable] } }, answer!];
    expect(judge({ nowIso: "2026-11-07T14:00:00.000Z", rows }).state).toBe("clear");
  });

  it("times the note off the pause bar the claim recorded — a 95% window is the cap at a 95 bar, and not at 99", () => {
    const [intent, answer] = claim({ after: reading({ atLimit: true }), key: "aaaaaaaa-1", outcome: "noCredit" });
    const window = { label: "weekly", resetAtIso: WEEK_ENDS, slot: "primary", usedPercent: 95 } as const;
    const at = ({ pauseAtPercent }: { pauseAtPercent: number }) => [
      { ...intent!, before: { ...reading({ atLimit: true }), pauseAtPercent, windows: [window] } },
      answer!,
    ];
    expect([
      judge({ nowIso: WEEK_ENDS, rows: at({ pauseAtPercent: 95 }) }).state,
      judge({ nowIso: WEEK_ENDS, rows: at({ pauseAtPercent: 99 }) }).state,
    ]).toEqual(["clear", "firing"]);
  });

  it("never times the note off a 99% window that had already reset when the claim was made", () => {
    const [intent, answer] = claim({ after: reading({ atLimit: true }), key: "aaaaaaaa-1", outcome: "noCredit" });
    const rolled = {
      label: "weekly",
      resetAtIso: "2026-11-05T13:00:00.000Z",
      slot: "primary",
      usedPercent: 99,
    } as const;
    const rows = [{ ...intent!, before: { ...reading({ atLimit: false }), windows: [rolled] } }, answer!];
    expect(judge({ nowIso: "2026-11-07T14:00:00.000Z", rows }).state).toBe("firing");
  });

  it("never lets one plan's answer stand for another plan's claim under the same key", () => {
    const rows = [
      ...claim({ after: undefined, key: "shared", outcome: undefined }),
      ...claim({ after: reading({ atLimit: false }), alias: "plan-b", key: "shared", outcome: "noCredit" }),
    ];
    const judged = judge({ rows });
    expect((judged as { subjects: readonly { id: string }[] }).subjects.map((subject) => subject.id)).toEqual([
      "plan-b",
    ]);
  });

  it("reads a reset written with an offset as the instant it names, not as text", () => {
    const [intent, answer] = claim({ after: reading({ atLimit: true }), key: "aaaaaaaa-1", outcome: "noCredit" });
    const window = {
      label: "weekly",
      resetAtIso: "2026-11-06T23:30:00-11:00",
      slot: "primary",
      usedPercent: 99,
    } as const;
    const rows = [{ ...intent!, before: { ...reading({ atLimit: true }), windows: [window] } }, answer!];
    expect([
      judge({ nowIso: "2026-11-07T00:00:00.000Z", rows }).state,
      judge({ nowIso: "2026-11-07T10:30:00.000Z", rows }).state,
    ]).toEqual(["firing", "clear"]);
  });

  it("ignores a claim journalled before claims carried readings — it cannot say why it failed", () => {
    const legacy: CodexResetJournalRow[] = [
      { alias: "plan-a", atIso: CLAIMED_AT, idempotencyKey: "aaaaaaaa-1", kind: "intent", v: 1 },
      { alias: "plan-a", atIso: CLAIMED_AT, idempotencyKey: "aaaaaaaa-1", kind: "outcome", outcome: "noCredit", v: 1 },
    ];
    expect(judge({ rows: legacy }).state).toBe("clear");
  });

  it("is unmeasurable, never clear, when the journal cannot be read", () => {
    expect(evaluateCodexResetFailed({ nowIso: NOW, rows: { kind: "unreadable", why: "malformed line 3" } })).toEqual({
      because: "the reset claims journal could not be read (malformed line 3), so whether a claim failed is unknown",
      monitorId: "codex-reset-failed",
      state: "unmeasurable",
    });
  });
});

describe("CODEX_RESET_FAILED", () => {
  it("is a floating notice naming the plans, with why each failed as what it unblocks", () => {
    const subject = { id: "plan-a, plan-b", key: "failed-0123456789ab", label: "plan-a: why; plan-b: why" };
    expect([CODEX_RESET_FAILED.floats, CODEX_RESET_FAILED.perSubject, CODEX_RESET_FAILED.context]).toEqual([
      true,
      undefined,
      undefined,
    ]);
    expect(CODEX_RESET_FAILED.what({ subject })).toBe(
      "A Codex reset claim failed on plan-a, plan-b — still at its limit",
    );
    expect(CODEX_RESET_FAILED.unblocks({ subject })).toBe("plan-a: why; plan-b: why");
  });
});

describe("readCodexResetFailed", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A throwaway home whose claims journal holds `rows`, or no journal at all. */
  function homeWith({ rows }: { rows: readonly CodexResetJournalRow[] | undefined }): string {
    const home = mkdtempSync(join(tmpdir(), "sw-reset-failed-"));
    homes.push(home);
    if (rows !== undefined) {
      const path = stateHomePaths({ home }).codexResetClaimsJsonl;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, rows.map((row) => `${JSON.stringify(row)}\n`).join(""), "utf8");
    }
    return home;
  }

  it("reads a home with no journal yet as clear, and a failed claim off disk as firing", () => {
    const failed = claim({ after: reading({ atLimit: true }), key: "aaaaaaaa-1", outcome: "nothingToReset" });
    expect(readCodexResetFailed({ home: homeWith({ rows: undefined }), nowIso: NOW }).state).toBe("clear");
    expect(readCodexResetFailed({ home: homeWith({ rows: failed }), nowIso: NOW }).state).toBe("firing");
  });
});
