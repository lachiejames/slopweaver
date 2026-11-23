/**
 * The sweep gate's predicate, arm by arm — including both ways a tick answers for an outcome and both ways
 * the gate refuses because it could not see.
 */
import { describe, expect, it } from "vitest";

import { ALL_OUTCOMES, judgeSweep } from "../../../../supervisor/outcomes/sweepGate.js";

import { boardRow, emittedFields, emittedOutcome, seat } from "./emittedRowFixture.js";

/** A capacity observation with the hold the caller names. */
const sources = ({ hold, status = "read" }: { hold?: boolean; status?: string }) => ({
  capacity: {
    ...(hold === undefined ? {} : { facts: { hold } }),
    observedAtIso: "2026-09-14T11:00:00Z",
    status,
    witness: { command: "read capacity.json", exitCode: null },
  },
});

/** A reconciliation carrying one outcome with the coverage the caller names, as reconcile emits it. */
const reconciliation = ({ live = 0, unspawned = ["a-ready-row"] }: { live?: number; unspawned?: readonly string[] }) =>
  emittedFields({
    outcomes: [
      emittedOutcome({
        live: Array.from({ length: live }, (_, index) =>
          seat({ rank: index + 1, session: `workspace:${String(index)}` }),
        ),
        unspawned: unspawned.map((id) => boardRow({ id })),
      }),
    ],
  });

/** Judge a free-capacity tick that answered for nothing against the reconciliation given. */
const judgeBare = ({ given }: { given: unknown }) =>
  judgeSweep({ actions: [], judgements: [], reconciliation: given, sources: sources({ hold: false }) });

/** Why a verdict was unreadable, or the verdict's kind when it was not — one value an assertion can pin. */
const whyOrKind = ({ verdict }: { verdict: ReturnType<typeof judgeSweep> }): string =>
  verdict.kind === "unreadable" ? verdict.why : verdict.kind;

/** One `spawned` action onto the row the caller names. */
const spawned = ({ id }: { id: string }) => [
  { actionId: "a1", kind: "spawned", outcome: "completed", subject: { id, kind: "handover", label: id } },
];

/** One `hold-rationale` judgement against the outcome the caller names. */
const heldFor = ({ id }: { id: string }) => [
  { judgementId: "j1", kind: "hold-rationale", subject: { id, kind: "outcome", label: id } },
];

describe("judgeSweep", () => {
  it("refuses a tick that left capacity free with an outcome nobody is on and no reason given", () => {
    const verdict = judgeSweep({
      actions: [],
      judgements: [],
      reconciliation: reconciliation({}),
      sources: sources({ hold: false }),
    });

    expect(verdict.kind).toBe("refused");
    const refused = verdict as Extract<typeof verdict, { kind: "refused" }>;
    expect(refused.outcomes).toEqual([
      {
        anchor: "transcript:s#t",
        firstRow: "a-ready-row",
        id: "gcp-backups",
        title: "Scheduled backups landing in GCP",
        unspawned: 1,
      },
    ]);
  });

  it("clears a tick that SPAWNED into the outcome, even though the reconciliation it read still showed it empty", () => {
    const verdict = judgeSweep({
      actions: spawned({ id: "a-ready-row" }),
      judgements: [],
      reconciliation: reconciliation({}),
      sources: sources({ hold: false }),
    });

    expect(verdict.kind).toBe("clean");
  });

  it("does not accept a spawn onto some OTHER row as an answer for this outcome", () => {
    const verdict = judgeSweep({
      actions: spawned({ id: "an-unrelated-row" }),
      judgements: [],
      reconciliation: reconciliation({}),
      sources: sources({ hold: false }),
    });

    expect(verdict.kind).toBe("refused");
  });

  it("clears a tick that named the outcome in a hold rationale, and one that answered for all of them at once", () => {
    const named = judgeSweep({
      actions: [],
      judgements: heldFor({ id: "gcp-backups" }),
      reconciliation: reconciliation({}),
      sources: sources({ hold: false }),
    });
    const blanket = judgeSweep({
      actions: [],
      judgements: heldFor({ id: ALL_OUTCOMES }),
      reconciliation: reconciliation({}),
      sources: sources({ hold: false }),
    });

    expect(named.kind).toBe("clean");
    expect(blanket.kind).toBe("clean");
  });

  it("does not accept a judgement of another kind, or one whose subject is not an outcome", () => {
    const wrongKind = judgeSweep({
      actions: [],
      judgements: [{ judgementId: "j", kind: "watch-disposition", subject: { id: "gcp-backups", kind: "outcome" } }],
      reconciliation: reconciliation({}),
      sources: sources({ hold: false }),
    });
    const wrongSubject = judgeSweep({
      actions: [],
      judgements: [{ judgementId: "j", kind: "hold-rationale", subject: { id: "gcp-backups", kind: "session" } }],
      reconciliation: reconciliation({}),
      sources: sources({ hold: false }),
    });

    expect(wrongKind.kind).toBe("refused");
    expect(wrongSubject.kind).toBe("refused");
  });

  it("clears every tick the machine was holding spawns on, whatever its coverage looked like", () => {
    const verdict = judgeSweep({
      actions: [],
      judgements: [],
      reconciliation: reconciliation({}),
      sources: sources({ hold: true }),
    });

    expect(verdict.kind).toBe("clean");
  });

  it("clears an outcome somebody is already on, and one with no ready row waiting", () => {
    const onIt = judgeSweep({
      actions: [],
      judgements: [],
      reconciliation: reconciliation({ live: 1 }),
      sources: sources({ hold: false }),
    });
    const nothingWaiting = judgeSweep({
      actions: [],
      judgements: [],
      reconciliation: reconciliation({ unspawned: [] }),
      sources: sources({ hold: false }),
    });

    expect(onIt.kind).toBe("clean");
    expect(nothingWaiting.kind).toBe("clean");
  });

  it("refuses rather than clearing when the reconciliation carries no coverage at all", () => {
    const verdict = judgeSweep({
      actions: [],
      judgements: [],
      reconciliation: { headline: "an older shape" },
      sources: sources({ hold: false }),
    });

    expect(verdict.kind).toBe("unreadable");
    expect((verdict as Extract<typeof verdict, { kind: "unreadable" }>).why).toContain(
      "the reconciliation names no `outcomeSource`",
    );
  });

  it("refuses rather than clearing when the tick never took a capacity reading it could judge", () => {
    const unavailable = judgeSweep({
      actions: [],
      judgements: [],
      reconciliation: reconciliation({}),
      sources: sources({ status: "unavailable" }),
    });
    const noHold = judgeSweep({
      actions: [],
      judgements: [],
      reconciliation: reconciliation({}),
      sources: sources({}),
    });
    const noSource = judgeSweep({ actions: [], judgements: [], reconciliation: reconciliation({}), sources: {} });

    expect(unavailable.kind).toBe("unreadable");
    expect((unavailable as Extract<typeof unavailable, { kind: "unreadable" }>).why).toContain("unavailable");
    expect(noHold.kind).toBe("unreadable");
    expect((noHold as Extract<typeof noHold, { kind: "unreadable" }>).why).toContain("`hold` reading");
    expect(noSource.kind).toBe("unreadable");
    expect((noSource as Extract<typeof noSource, { kind: "unreadable" }>).why).toContain("no capacity observation");
  });
});

// An empty `outcomes` list once read as "everything covered" when the outcomes had simply not
// loaded. Empty is now legitimate exactly when the reconciliation SAYS so, by the source it declares.
describe("judgeSweep on an EMPTY coverage list — clean only when the declared source says so", () => {
  it("clears a tick when no register exists yet: there is no kept outcome to answer for", () => {
    const verdict = judgeBare({ given: emittedFields({ outcomeSource: { kind: "absent" }, outcomes: [] }) });

    expect(verdict).toEqual({ kind: "clean" });
  });

  it("clears a tick whose register holds no active outcome, when it says it read zero", () => {
    const verdict = judgeBare({ given: emittedFields({ outcomes: [] }) });

    expect(verdict).toEqual({ kind: "clean" });
  });

  it("refuses an empty list that declares no source, a count that disagrees with its rows, and rows beside an absent source", () => {
    const one = reconciliation({});
    const verdicts = [
      { headline: "a register that did not load", outcomes: [] },
      { ...one, outcomeSource: { count: 2, kind: "present" } },
      { ...one, outcomeSource: { kind: "absent" } },
      { ...emittedFields({ outcomes: [] }), outcomeSource: { count: -1, kind: "present" } },
    ].map((given) => whyOrKind({ verdict: judgeBare({ given }) }));

    const rerun =
      " — re-run `slopweaver handover reconcile --json` with this checkout, which reads the owner's outcomes off the Workstreams register";
    expect(verdicts.map((why) => why.split(": ")[0])).toEqual([
      `the reconciliation names no \`outcomeSource\`${rerun}`,
      `the reconciliation's register held 2 outcome(s) but it carries 1${rerun}`,
      `the reconciliation says no register exists yet but carries 1 outcome(s)${rerun}`,
      "the reconciliation's `outcomeSource.count` is malformed",
    ]);
  });

  it("refuses an array of entries none of which is a record, and a row missing the owner's words", () => {
    const wordless = reconciliation({}).outcomes.map(({ words: _words, ...rest }) => rest);
    const verdicts = [
      { outcomeSource: { count: 3, kind: "present" }, outcomes: [null, "gcp-backups", 7] },
      { outcomeSource: { count: 1, kind: "present" }, outcomes: wordless },
    ].map((given) => whyOrKind({ verdict: judgeBare({ given }) }));

    expect(verdicts.map((why) => why.split(": ")[0])).toEqual([
      "the reconciliation's outcome row 0 is malformed at the row itself",
      'the reconciliation\'s outcome row 0 "gcp-backups" is malformed at `words`',
    ]);
  });

  // A counterexample: an empty title, no emitted `rows`, and a live entry with an empty session and no row or
  // rank once read as clean.
  it("refuses the r1 counterexample rather than clearing it, naming the row and the field", () => {
    const verdict = judgeSweep({
      actions: [],
      judgements: [],
      reconciliation: {
        outcomeSource: { count: 1, kind: "present" },
        outcomes: [
          {
            anchor: "a",
            id: "x",
            live: [{ session: "" }],
            title: "",
            unspawned: [{ id: "r", label: "row" }],
            words: "w",
          },
        ],
      },
      sources: { capacity: { facts: { hold: false }, status: "read" } },
    });

    expect(verdict.kind).toBe("unreadable");
    expect(whyOrKind({ verdict }).split(": ")[0]).toBe(
      'the reconciliation\'s outcome row 0 "x" is malformed at `live.0.rank`',
    );
  });
});

// One level up: an `absent` source carrying a stray `count` once read as clean, because the reader took
// `kind` and ignored the rest. The source and the document's other outcome fields now read as strictly as a row.
describe("judgeSweep on a malformed outcome half — the source and the lists beside the rows", () => {
  it("refuses the r1 counterexample, an absent source carrying a count, rather than clearing it", () => {
    const verdict = judgeBare({ given: { outcomeSource: { count: 5, kind: "absent" }, outcomes: [] } });

    expect(verdict.kind).toBe("unreadable");
    expect(whyOrKind({ verdict })).toContain(
      'the reconciliation\'s `outcomeSource` is malformed: Unrecognized key: "count"',
    );
  });

  /** A well-formed empty absent half, and a well-formed present half with one uncovered outcome, to break one field of. */
  const absent = emittedFields({ outcomeSource: { kind: "absent" }, outcomes: [] });
  const one = reconciliation({});

  /** Every way the source or a list beside the rows can be malformed, with the head the refusal must open on. */
  const MALFORMED_HALF: readonly { kind: string; given: unknown; head: string }[] = [
    {
      given: { ...absent, outcomeSource: { count: 5, kind: "absent" } },
      head: "the reconciliation's `outcomeSource` is malformed",
      kind: "a count on an absent source, every other field well formed",
    },
    {
      given: { ...one, outcomeSource: { count: 1, extra: true, kind: "present" } },
      head: "the reconciliation's `outcomeSource` is malformed",
      kind: "an unknown key on a present source",
    },
    {
      given: { ...absent, outcomeSource: { kind: "stale" } },
      head: "the reconciliation's `outcomeSource.kind` is malformed",
      kind: "a kind reconcile never writes",
    },
    {
      given: { ...one, outcomeSource: { count: 0.5, kind: "present" } },
      head: "the reconciliation's `outcomeSource.count` is malformed",
      kind: "a fractional count",
    },
    {
      given: { ...one, uncoveredOutcomes: undefined },
      head: "the reconciliation names no `uncoveredOutcomes` — re-run `slopweaver handover reconcile --json` with this checkout, which reads the owner's outcomes off the Workstreams register",
      kind: "a missing uncovered list",
    },
    {
      given: { ...one, unanchoredOutcomes: [""] },
      head: "the reconciliation's `unanchoredOutcomes.0` is malformed",
      kind: "an empty id in the unanchored list",
    },
    {
      given: { ...one, uncoveredOutcomes: [] },
      head: "the reconciliation's `uncoveredOutcomes` is [] but its rows leave [gcp-backups] with nobody on them — re-run `slopweaver handover reconcile --json` with this checkout, which reads the owner's outcomes off the Workstreams register",
      kind: "an uncovered list the rows disagree with",
    },
    {
      given: { ...absent, unanchoredOutcomes: ["an-entry"] },
      head: "the reconciliation says no register exists yet but names 1 unanchored entry(ies) — re-run `slopweaver handover reconcile --json` with this checkout, which reads the owner's outcomes off the Workstreams register",
      kind: "an unanchored entry beside an absent source",
    },
  ];

  it("covers every kind it claims to, over halves that read clean unbroken", () => {
    expect(MALFORMED_HALF.length).toBeGreaterThan(0);
    expect([judgeBare({ given: absent }).kind, judgeBare({ given: one }).kind]).toEqual(["clean", "refused"]);
  });

  it.each(MALFORMED_HALF)("refuses $kind", ({ given, head }) => {
    expect(whyOrKind({ verdict: judgeBare({ given }) }).split(": ")[0]).toBe(head);
  });
});
