/**
 * The merge hold's pure decisions: decoding the document, judging age and staleness, and — the one that
 * actually stops a merge — deciding whether one invocation may proceed past a standing hold.
 */
import { describe, expect, it } from "vitest";
import { type Measured, measured, unmeasurable } from "../../../../measurement/status.js";
import {
  baseMovedRemedy,
  DEFAULT_HOLD_STALE_MINUTES,
  type HoldReport,
  holdAgeMinutes,
  holdEvent,
  holderIsGone,
  holdFor,
  holdIsStale,
  holdReport,
  holdStatusJson,
  holdStatusLines,
  type MergeHold,
  mergeHoldDocument,
  mergeHoldGate,
  parseMergeHolds,
  staleHoldEvent,
  withStaleWarned,
} from "../../../../outbound/github/mergeHold.js";

const PLACED = "2026-08-28T01:00:00.000Z";

/** One standing hold; a case overrides only the field it is about. */
function hold(over: Partial<MergeHold> = {}): MergeHold {
  return {
    atIso: PLACED,
    holder: "a-session",
    pr: 32,
    repo: "owner/name",
    staleMinutes: DEFAULT_HOLD_STALE_MINUTES,
    staleWarnedAtIso: undefined,
    why: "rebase hell",
    ...over,
  };
}

describe("parseMergeHolds", () => {
  it("reads back exactly what mergeHoldDocument wrote", () => {
    const written = mergeHoldDocument({ holds: [hold()] });

    expect(parseMergeHolds({ raw: JSON.parse(JSON.stringify(written)) })).toEqual([hold()]);
  });

  it("reports no hold for an absent document, so a home that never held anything never refuses", () => {
    expect(parseMergeHolds({ raw: undefined })).toEqual([]);
  });

  it("reports no hold for a document whose holds field is not a list", () => {
    expect(parseMergeHolds({ raw: { holds: "none", version: 1 } })).toEqual([]);
  });

  it("drops an entry missing a load-bearing field rather than failing the whole read", () => {
    const raw = { holds: [{ ...hold(), pr: undefined }, hold({ pr: 41 })], version: 1 };

    expect(parseMergeHolds({ raw }).map((entry) => entry.pr)).toEqual([41]);
  });

  it("drops an entry whose atIso is not a date", () => {
    expect(parseMergeHolds({ raw: { holds: [{ ...hold(), atIso: "whenever" }], version: 1 } })).toEqual([]);
  });

  it("defaults a missing threshold rather than dropping an otherwise whole hold", () => {
    const raw = { holds: [{ ...hold(), staleMinutes: undefined }], version: 1 };

    expect(parseMergeHolds({ raw })[0]!.staleMinutes).toBe(DEFAULT_HOLD_STALE_MINUTES);
  });
});

describe("holdFor", () => {
  it("finds the hold governing one repository", () => {
    const holds = [hold({ repo: "owner/other", pr: 7 }), hold()];

    expect(holdFor({ holds, repo: "owner/name" })!.pr).toBe(32);
  });

  it("finds nothing for a repository nothing holds", () => {
    expect(holdFor({ holds: [hold()], repo: "owner/other" })).toBe(undefined);
  });
});

describe("holdAgeMinutes and holdIsStale", () => {
  it("counts whole minutes since the hold was placed", () => {
    expect(holdAgeMinutes({ hold: hold(), nowIso: "2026-08-28T01:29:59.000Z" })).toBe(29);
  });

  it("floors a backwards clock at zero rather than reporting a negative age", () => {
    expect(holdAgeMinutes({ hold: hold(), nowIso: "2026-08-28T00:00:00.000Z" })).toBe(0);
  });

  it("is fresh one minute before its own threshold", () => {
    expect(holdIsStale({ hold: hold(), nowIso: "2026-08-28T01:29:00.000Z" })).toBe(false);
  });

  it("is stale exactly at its own threshold", () => {
    expect(holdIsStale({ hold: hold(), nowIso: "2026-08-28T01:30:00.000Z" })).toBe(true);
  });

  it("judges by the threshold the holder chose, not the default", () => {
    expect(holdIsStale({ hold: hold({ staleMinutes: 120 }), nowIso: "2026-08-28T02:00:00.000Z" })).toBe(false);
  });
});

describe("holdReport", () => {
  it("carries the age, the staleness verdict and the holder's liveness in one value", () => {
    const report = holdReport({
      hold: hold(),
      holderLive: measured({ value: true }),
      nowIso: "2026-08-28T02:27:00.000Z",
    });

    expect(report.ageMinutes).toBe(87);
    expect(report.stale).toBe(true);
    expect(report.holderLive).toEqual({ known: true, value: true });
  });
});

describe("holderIsGone", () => {
  it("is true only on positive proof the holder is not in the registry", () => {
    const report = holdReport({ hold: hold(), holderLive: measured({ value: false }), nowIso: PLACED });

    expect(holderIsGone({ report })).toBe(true);
  });

  it("is false for a live holder", () => {
    const report = holdReport({ hold: hold(), holderLive: measured({ value: true }), nowIso: PLACED });

    expect(holderIsGone({ report })).toBe(false);
  });

  it("is false when liveness could not be measured — an unreadable registry is not a dead session", () => {
    const report = holdReport({
      hold: hold(),
      holderLive: unmeasurable<boolean>({ why: "the registry would not decode" }),
      nowIso: PLACED,
    });

    expect(holderIsGone({ report })).toBe(false);
  });
});

describe("holdStatusLines", () => {
  /** One measured report over the shared fixture hold. */
  function report({ holderLive, nowIso }: { holderLive: Measured<boolean>; nowIso: string }): HoldReport {
    return holdReport({ hold: hold(), holderLive, nowIso });
  }

  it("says plainly that nothing is held", () => {
    expect(holdStatusLines({ reports: [] })).toEqual([
      "no merge hold stands: every pull request may merge through the door.",
    ]);
  });

  it("marks a hold past its threshold STALE in the line a reader scans", () => {
    const lines = holdStatusLines({
      reports: [report({ holderLive: measured({ value: true }), nowIso: "2026-08-28T02:27:00.000Z" })],
    });

    expect(lines).toEqual(["owner/name#32\theld 87m STALE\tby a-session\trebase hell"]);
  });

  it("leaves a fresh hold with a live holder unmarked", () => {
    const lines = holdStatusLines({
      reports: [report({ holderLive: measured({ value: true }), nowIso: "2026-08-28T01:05:00.000Z" })],
    });

    expect(lines).toEqual(["owner/name#32\theld 5m\tby a-session\trebase hell"]);
  });

  it("flags a holder that is not a live session, and names the release command", () => {
    const lines = holdStatusLines({
      reports: [report({ holderLive: measured({ value: false }), nowIso: "2026-08-28T01:05:00.000Z" })],
    });

    expect(lines).toEqual([
      "owner/name#32\theld 5m\tby a-session GONE\trebase hell",
      "  its holder a-session is not in the live-session registry — nobody is landing #32. " +
        "Release it with `slopweaver github release --pr 32 --repo owner/name` once you have checked whether it landed.",
    ]);
  });

  it("says liveness is unknown rather than calling an unmeasurable holder gone", () => {
    const lines = holdStatusLines({
      reports: [
        report({
          holderLive: unmeasurable<boolean>({ why: "the registry would not decode" }),
          nowIso: "2026-08-28T01:05:00.000Z",
        }),
      ],
    });

    expect(lines).toEqual(["owner/name#32\theld 5m\tby a-session (liveness unknown)\trebase hell"]);
  });
});

describe("holdStatusJson", () => {
  it("prints no holds as an empty list", () => {
    expect(holdStatusJson({ reports: [] })).toBe('{"holds":[]}');
  });

  it("carries each hold's own fields, then its age, gone verdict, liveness and staleness", () => {
    const report = holdReport({
      hold: hold(),
      holderLive: measured({ value: false }),
      nowIso: "2026-08-28T01:05:00.000Z",
    });

    expect(holdStatusJson({ reports: [report] })).toBe(
      '{"holds":[{"atIso":"2026-08-28T01:00:00.000Z","holder":"a-session","pr":32,"repo":"owner/name",' +
        '"staleMinutes":30,"why":"rebase hell","ageMinutes":5,"holderGone":true,' +
        '"holderLive":{"known":true,"value":false},"stale":false}]}',
    );
  });
});

describe("mergeHoldGate", () => {
  it("says nothing and refuses nothing when no hold stands", () => {
    expect(mergeHoldGate({ hold: undefined, nowIso: PLACED, number: 41 })).toEqual({ lines: [], refused: false });
  });

  it("lets the held pull request through, and says so rather than staying silent", () => {
    const gate = mergeHoldGate({ hold: hold(), nowIso: "2026-08-28T01:10:00.000Z", number: 32 });

    expect(gate.refused).toBe(false);
    expect(gate.lines).toEqual([
      "merge hold: this IS the held pull request owner/name#32 — placed by a-session at " +
        `${PLACED} (10m ago). It does not block you.`,
    ]);
  });

  it("refuses a different pull request, naming the held one, the holder and the release command", () => {
    const gate = mergeHoldGate({ hold: hold(), nowIso: "2026-08-28T01:10:00.000Z", number: 41 });

    expect(gate.refused).toBe(true);
    expect(gate.lines[0]).toBe(
      "a merge hold stands on owner/name: owner/name#32 owns the merge queue, and this invocation is " +
        `for #41 — placed by a-session at ${PLACED} (10m ago).`,
    );
    expect(gate.lines[1]).toBe("why: rebase hell");
    expect(gate.lines[2]).toBe(
      "wait for owner/name#32 to land, or clear the hold with " +
        "`slopweaver github release --pr 32 --repo owner/name`.",
    );
    expect(gate.lines[3]).toBe(
      "the hold refuses slopweaver's own landing verbs — `github merge` and `github enqueue`. `gh pr merge`, " +
        "GitHub's own 'Merge when ready' button and an administrator override still bypass it entirely.",
    );
  });

  it("refuses an invocation that names no pull request, because it cannot be shown to be the held one", () => {
    const gate = mergeHoldGate({ hold: hold(), nowIso: "2026-08-28T01:10:00.000Z", number: undefined });

    expect(gate.refused).toBe(true);
    expect(gate.lines[2]).toBe(
      "name this invocation's pull request with --number <n> so the report can tell whether the hold is yours.",
    );
  });
});

describe("staleHoldEvent", () => {
  it("owes nothing while the hold is fresh", () => {
    expect(staleHoldEvent({ hold: hold(), nowIso: "2026-08-28T01:29:00.000Z" })).toBe(undefined);
  });

  it("owes a warn-severity event once the threshold is crossed", () => {
    const event = staleHoldEvent({ hold: hold(), nowIso: "2026-08-28T02:27:00.000Z" })!;

    expect(event.source).toBe("github-hold");
    expect(event.kind).toBe("stale");
    expect(event.pr).toBe(32);
    expect(event.repo).toBe("owner/name");
    expect(event.why).toContain("has held the merge queue for 87m (threshold 30m)");
    expect(event.why).toContain("slopweaver github release --pr 32 --repo owner/name");
  });

  it("owes nothing a second time, so eight sessions reading it produce one warning", () => {
    const nowIso = "2026-08-28T02:27:00.000Z";
    const warned = withStaleWarned({ hold: hold(), nowIso });

    expect(staleHoldEvent({ hold: warned, nowIso: "2026-08-28T03:00:00.000Z" })).toBe(undefined);
  });
});

describe("holdEvent", () => {
  it("carries the repository and number a reader compares against, not just the sentence", () => {
    const event = holdEvent({ hold: hold(), kind: "released", nowIso: PLACED, why: "landed" });

    expect(event).toEqual({
      atIso: PLACED,
      kind: "released",
      pr: 32,
      repo: "owner/name",
      source: "github-hold",
      why: "landed",
    });
  });
});

describe("baseMovedRemedy", () => {
  const NOW = "2026-08-28T01:10:00.000Z";

  it("prescribes ONE rebase then the QUEUE when nothing is held, with the repository filled in", () => {
    const lines = baseMovedRemedy({ lane: { hold: undefined, nowIso: NOW, repo: "owner/name", sessionId: "me" } });
    expect(lines).toEqual([
      "remedy: rebase onto the current base ONCE, run the full gate, push, and land with " +
        "`slopweaver github enqueue --pr <n> --repo owner/name`",
      "do NOT take a merge hold and do NOT hand a baton on: GitHub orders the queue, tests your entry against " +
        "the tip plus everything ahead of it, and nothing waits on a session staying alive",
    ]);
  });

  it("tells the session that holds the queue that this is the lap that lands", () => {
    const lines = baseMovedRemedy({
      lane: { hold: hold({ holder: "me" }), nowIso: NOW, repo: "owner/name", sessionId: "me" },
    });
    expect(lines).toEqual([
      "remedy: you own the merge hold on owner/name (owner/name#32, placed 10m ago) — this is the lap that lands: " +
        "rebase onto the current base, run the full gate ONCE, push, and `merge --admin --number 32` releases it",
    ]);
  });

  it("tells everyone else NOT to rebase yet, naming the holder, its age and its reason", () => {
    const lines = baseMovedRemedy({ lane: { hold: hold(), nowIso: NOW, repo: "owner/name", sessionId: "me" } });
    expect(lines).toEqual([
      "remedy: owner/name#32 owns the merge hold on owner/name (held 10m by a-session: rebase hell) — do NOT rebase " +
        "yet: every lap you run before it lands is one you lose",
      "wait for owner/name#32 to land, then rebase onto the current base ONCE",
    ]);
  });

  it("marks a stale hold in the line, so a reader does not wait on a holder that went away", () => {
    const lines = baseMovedRemedy({
      lane: { hold: hold(), nowIso: "2026-08-28T01:30:00.000Z", repo: "owner/name", sessionId: "me" },
    });
    expect(lines[0]).toContain("(held 30m STALE by a-session: rebase hell)");
  });

  it("names the queue, with the repository left for the reader, when no lane could be read at all", () => {
    expect(baseMovedRemedy({ lane: undefined })[0]).toContain("--repo <owner/name>");
  });

  it("never reads a hold as its own from a session with no readable id", () => {
    const lines = baseMovedRemedy({
      lane: { hold: hold({ holder: "me" }), nowIso: NOW, repo: "owner/name", sessionId: undefined },
    });
    expect(lines[0]).toContain("owner/name#32 owns the merge hold");
  });
});
