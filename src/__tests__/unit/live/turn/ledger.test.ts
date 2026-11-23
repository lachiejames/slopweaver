/**
 * The turn ledger's pure half, both modules of it: `ledgerWindow.ts` grouping a lifecycle log by ask and
 * narrowing it before anything is read off disk, and `ledger.ts` joining one ask's five phases out of four
 * record sets with the mean/median footer over them. One file because the second half's every fixture is a
 * stream the first half would have grouped, and splitting them would duplicate all of it.
 */
import { describe, expect, it } from "vitest";

import type { ReviewVerdict } from "../../../../admit/reviewVerdict.js";
import type { AskLifecycleEvent } from "../../../../live/ask/lifecycleEvents.js";
import type { CheckpointSet, DraftCheckpoint } from "../../../../live/turn/checkpoint.js";
import type { TurnCompletion, TurnCompletionEvent } from "../../../../live/turn/envelope.js";
import {
  GENERATION_SCOPED_PHASES,
  TURN_LEDGER_PHASE_BOUNDS,
  TURN_LEDGER_PHASE_KEYS,
  TURN_LEDGER_PHASE_LABELS,
  turnLedgerRow,
  turnLedgerStats,
} from "../../../../live/turn/ledger.js";
import { turnLedgerCompletions, turnLedgerGroups, turnLedgerWindow } from "../../../../live/turn/ledgerWindow.js";

/** The one ts every fixture below is tagged at. */
const TAG_TS = "1789788122.066099";
const TAG_ISO = "2026-09-19T03:22:02.000Z";

/** The identity fields every event in one ask's stream repeats. */
const ASK = { channel: "C1", messageTs: TAG_TS, threadTs: TAG_TS } as const;

/** A `captured` event, with the fields a test varies overridable. */
const captured = (over: Partial<Extract<AskLifecycleEvent, { kind: "captured" }>> = {}): AskLifecycleEvent => ({
  ...ASK,
  kind: "captured",
  surface: "channel",
  text: "why did the staging pool exhaust",
  tsIso: "2026-09-19T03:22:12.000Z",
  userId: "U_ASKER",
  ...over,
});

/** A `dispatched` event at a given instant. */
const dispatched = ({ tsIso }: { tsIso: string }): AskLifecycleEvent => ({
  ...ASK,
  decision: {
    confidence: "high",
    needs: [],
    rationale: "worth a real look",
    response: "respond",
    schemaVersion: 1,
    tier: "fresh-visible-session",
    truthMode: "current",
  },
  kind: "dispatched",
  leaseExpiresAt: "2026-09-19T05:22:12.000Z",
  tier: "fresh-visible-session",
  tsIso,
});

/** An `answered` event at a given instant. */
const answered = ({ tsIso }: { tsIso: string }): AskLifecycleEvent => ({
  ...ASK,
  answerTs: "1789790000.000100",
  kind: "answered",
  tsIso,
});

/** One draft checkpoint, recorded at a given instant. */
const draft = (over: Partial<DraftCheckpoint> = {}): DraftCheckpoint => ({
  answerDigest: "sha256:aaaa",
  dispatchId: '["C1","1.1","1.1"]',
  draftFile: "draft-sha256-aaaa.json",
  leaseExpiresAt: "2026-09-19T05:22:12.000Z",
  recordedAtIso: "2026-09-19T03:40:12.000Z",
  ...over,
});

/** One verdict, with its outcome overridable. */
const verdict = (over: Partial<ReviewVerdict> = {}): ReviewVerdict => ({
  answerDigest: "sha256:aaaa",
  authorSession: "author",
  claims: [],
  outcome: "clean",
  reviewerSession: "reviewer",
  schemaVersion: 1,
  ...over,
});

/** A checkpoint set built from plain instants, so a test never touches the filesystem. */
const checkpointOf = ({
  draftIsos = [],
  rounds = [],
}: {
  draftIsos?: readonly string[];
  rounds?: readonly { spawnedAt: string; verdict: ReviewVerdict | undefined }[];
} = {}): CheckpointSet => ({
  drafts: draftIsos.map((recordedAtIso) => draft({ recordedAtIso })),
  rounds: rounds.map((entry) => ({
    round: { file: "verdict.json", reviewer: "workspace:1", spawnedAt: entry.spawnedAt, standing: true },
    verdict: entry.verdict,
  })),
});

/** One completion for this ask. */
const completion = (over: Partial<TurnCompletion> = {}): TurnCompletion => ({
  askIdentity: { ...ASK },
  primary: { answerTs: "1789790000.000100", kind: "answered" },
  provenance: { modelId: "the dispatched worker in workspace:166" },
  secondaryFailures: [],
  turnId: "turn-1",
  workingTs: "1789788140.000100",
  ...over,
});

describe("the declared phase registry", () => {
  it("labels and bounds every phase it declares, and nothing else", () => {
    expect(TURN_LEDGER_PHASE_KEYS.length).toBeGreaterThan(0);

    expect(Object.keys(TURN_LEDGER_PHASE_LABELS).toSorted()).toEqual([...TURN_LEDGER_PHASE_KEYS].toSorted());
    expect(Object.keys(TURN_LEDGER_PHASE_BOUNDS).toSorted()).toEqual([...TURN_LEDGER_PHASE_KEYS].toSorted());
    expect([...GENERATION_SCOPED_PHASES].toSorted()).toEqual(["investigation", "review"]);
  });
});

describe("turnLedgerGroups", () => {
  it("gathers one ask's events under one key and anchors it on the tag's own instant", () => {
    const groups = turnLedgerGroups({
      events: [captured(), dispatched({ tsIso: "2026-09-19T03:24:12.000Z" }), answered({ tsIso: TAG_ISO })],
    });

    expect(groups.length).toBe(1);
    expect(groups[0]!.anchorIso).toBe(TAG_ISO);
    expect(groups[0]!.events.length).toBe(3);
    expect(groups[0]!.askIdentity).toEqual({ channel: "C1", messageTs: TAG_TS, threadTs: TAG_TS });
  });

  it("drops a key with no captured event, exactly as the lifecycle fold does", () => {
    const groups = turnLedgerGroups({ events: [answered({ tsIso: TAG_ISO })] });

    expect(groups).toEqual([]);
  });

  it("orders groups newest anchor first", () => {
    const older = { channel: "C1", messageTs: "1789700000.000100", threadTs: "1789700000.000100" } as const;
    const groups = turnLedgerGroups({
      events: [captured({ ...older }), captured()],
    });

    expect(groups.map((group) => group.askIdentity.messageTs)).toEqual([TAG_TS, "1789700000.000100"]);
  });

  it("anchors on the capture instant when the message ts will not convert", () => {
    const groups = turnLedgerGroups({
      events: [captured({ channel: "C1", messageTs: "not-a-ts", threadTs: "not-a-ts" })],
    });

    expect(groups[0]!.anchorIso).toBe("2026-09-19T03:22:12.000Z");
  });
});

describe("turnLedgerWindow", () => {
  const groups = turnLedgerGroups({
    events: [captured(), captured({ channel: "C2", messageTs: "1789700000.000100", threadTs: "1789700000.000100" })],
  });

  it("keeps everything when neither bound is given", () => {
    expect(turnLedgerWindow({ channel: undefined, groups, sinceIso: undefined }).length).toBe(2);
  });

  it("keeps only asks anchored at or after --since", () => {
    const kept = turnLedgerWindow({ channel: undefined, groups, sinceIso: "2026-09-19T00:00:00.000Z" });

    expect(kept.map((group) => group.askIdentity.messageTs)).toEqual([TAG_TS]);
  });

  it("keeps only the named channel", () => {
    const kept = turnLedgerWindow({ channel: "C2", groups, sinceIso: undefined });

    expect(kept.map((group) => group.askIdentity.channel)).toEqual(["C2"]);
  });
});

describe("turnLedgerCompletions", () => {
  it("keeps both completions of a re-dispatched ask, in file order", () => {
    const events: readonly TurnCompletionEvent[] = [
      { completion: completion({ turnId: "turn-1" }), kind: "turn-completed", tsIso: TAG_ISO },
      { completion: completion({ turnId: "turn-2" }), kind: "turn-completed", tsIso: TAG_ISO },
    ];

    const byKey = turnLedgerCompletions({ events });

    expect([...byKey.keys()]).toEqual([JSON.stringify(["C1", TAG_TS])]);
    expect(byKey.get(JSON.stringify(["C1", TAG_TS]))!.map((entry) => entry.turnId)).toEqual(["turn-1", "turn-2"]);
  });
});

describe("turnLedgerRow", () => {
  it("measures all five phases of a turn the record sets fully describe", () => {
    const row = turnLedgerRow({
      checkpoint: checkpointOf({
        draftIsos: ["2026-09-19T03:40:12.000Z"],
        rounds: [{ spawnedAt: "2026-09-19T03:45:12.000Z", verdict: verdict({ outcome: "broken" }) }],
      }),
      completions: [completion()],
      events: [
        captured(),
        dispatched({ tsIso: "2026-09-19T03:24:12.000Z" }),
        answered({ tsIso: "2026-09-19T04:13:02.000Z" }),
      ],
    })!;

    expect(row.phases.noticed).toBe(10);
    expect(row.phases.spinUp).toBe(120);
    expect(row.phases.investigation).toBe(960);
    expect(row.phases.review).toBe(1670);
    expect(row.phases.total).toBe(3060);
    expect(row.ending).toBe("answered");
    expect(row.terminal).toBe(true);
    expect(row.rounds).toEqual([{ outcome: "broken", spawnedAtIso: "2026-09-19T03:45:12.000Z" }]);
    expect(row.modelId).toBe("the dispatched worker in workspace:166");
    expect(row.completions).toBe(1);
    expect(row.askText).toBe("why did the staging pool exhaust");
    expect(row.taggedIso).toBe(TAG_ISO);
  });

  it("names a span that closed before it opened rather than reporting a negative duration", () => {
    // The listener wrote `captured` 3h14m BEFORE the tag's own Slack instant — three real rows on the
    // operator's home read this way.
    const row = turnLedgerRow({
      checkpoint: checkpointOf(),
      completions: [],
      events: [captured({ tsIso: "2026-09-19T00:08:00.000Z" }), answered({ tsIso: "2026-09-19T05:00:00.000Z" })],
    })!;

    expect(row.phases.noticed).toBe(undefined);
    expect(row.reversedPhases).toEqual(["noticed"]);
    expect(row.phases.total).toBe(5878);
    expect(Object.values(row.phases).filter((seconds) => seconds < 0)).toEqual([]);
  });

  it("carries an empty reversedPhases on a turn whose every span runs forwards", () => {
    const row = turnLedgerRow({
      checkpoint: checkpointOf({ draftIsos: ["2026-09-19T03:40:12.000Z"] }),
      completions: [],
      events: [
        captured(),
        dispatched({ tsIso: "2026-09-19T03:24:12.000Z" }),
        answered({ tsIso: "2026-09-19T04:13:02.000Z" }),
      ],
    })!;

    expect(row.reversedPhases).toEqual([]);
  });

  it("refuses a stream with no captured event", () => {
    const row = turnLedgerRow({
      checkpoint: checkpointOf(),
      completions: [],
      events: [answered({ tsIso: TAG_ISO })],
    });

    expect(row).toBe(undefined);
  });

  it("leaves every terminal-bounded phase absent while the ask is still open", () => {
    const row = turnLedgerRow({
      checkpoint: checkpointOf({ rounds: [{ spawnedAt: "2026-09-19T03:45:12.000Z", verdict: verdict() }] }),
      completions: [],
      events: [captured(), dispatched({ tsIso: "2026-09-19T03:24:12.000Z" })],
    })!;

    expect(row.phases.review).toBe(undefined);
    expect(row.phases.total).toBe(undefined);
    expect(row.ending).toBe("open:dispatched");
    expect(row.terminal).toBe(false);
    expect(row.modelId).toBe(undefined);
  });

  it("falls back to the first review round when no draft was checkpointed", () => {
    const row = turnLedgerRow({
      checkpoint: checkpointOf({ rounds: [{ spawnedAt: "2026-09-19T03:45:12.000Z", verdict: verdict() }] }),
      completions: [],
      events: [
        captured(),
        dispatched({ tsIso: "2026-09-19T03:24:12.000Z" }),
        answered({ tsIso: "2026-09-19T04:13:02.000Z" }),
      ],
    })!;

    expect(row.composedIso).toBe("2026-09-19T03:45:12.000Z");
    expect(row.phases.investigation).toBe(1260);
  });

  it("reports a round whose verdict will not read as unreadable rather than dropping it", () => {
    const row = turnLedgerRow({
      checkpoint: checkpointOf({ rounds: [{ spawnedAt: "2026-09-19T03:45:12.000Z", verdict: undefined }] }),
      completions: [],
      events: [captured(), dispatched({ tsIso: "2026-09-19T03:24:12.000Z" })],
    })!;

    expect(row.rounds).toEqual([{ outcome: "unreadable", spawnedAtIso: "2026-09-19T03:45:12.000Z" }]);
  });

  it("omits the ask text when the capture row predates the field", () => {
    const row = turnLedgerRow({
      checkpoint: checkpointOf(),
      completions: [],
      events: [captured({ text: undefined })],
    })!;

    expect(row.askText).toBe(undefined);
    expect(row.ending).toBe("open:captured");
  });

  it("measures spin-up from the FIRST dispatch and investigation from the LAST", () => {
    const row = turnLedgerRow({
      checkpoint: checkpointOf({ draftIsos: ["2026-09-19T03:30:12.000Z", "2026-09-19T04:10:12.000Z"] }),
      completions: [completion(), completion({ turnId: "turn-2" })],
      events: [
        captured(),
        dispatched({ tsIso: "2026-09-19T03:24:12.000Z" }),
        dispatched({ tsIso: "2026-09-19T04:04:12.000Z" }),
        answered({ tsIso: "2026-09-19T04:20:12.000Z" }),
      ],
    })!;

    expect(row.dispatches).toBe(2);
    expect(row.firstDispatchedIso).toBe("2026-09-19T03:24:12.000Z");
    expect(row.lastDispatchedIso).toBe("2026-09-19T04:04:12.000Z");
    expect(row.phases.spinUp).toBe(120);
    expect(row.composedIso).toBe("2026-09-19T04:10:12.000Z");
    expect(row.phases.investigation).toBe(360);
    expect(row.completions).toBe(2);
  });

  it("carries the last completion's secondary diagnostics", () => {
    const row = turnLedgerRow({
      checkpoint: checkpointOf(),
      completions: [completion({ secondaryFailures: [{ kind: "title", reason: "not_in_channel" }] })],
      events: [captured(), answered({ tsIso: "2026-09-19T04:13:02.000Z" })],
    })!;

    expect(row.secondaryFailures).toEqual(["title: not_in_channel"]);
  });
});

describe("turnLedgerStats", () => {
  /** Two clean single-dispatch rows, 10s and 20s of notice, and one re-dispatched row. */
  const rowsOf = (): readonly ReturnType<typeof turnLedgerRow>[] => [
    turnLedgerRow({
      checkpoint: checkpointOf({ draftIsos: ["2026-09-19T03:40:12.000Z"] }),
      completions: [],
      events: [
        captured(),
        dispatched({ tsIso: "2026-09-19T03:24:12.000Z" }),
        answered({ tsIso: "2026-09-19T04:13:02.000Z" }),
      ],
    }),
    turnLedgerRow({
      checkpoint: checkpointOf({ draftIsos: ["2026-09-19T04:10:12.000Z"] }),
      completions: [],
      events: [
        captured({ tsIso: "2026-09-19T03:22:22.000Z" }),
        dispatched({ tsIso: "2026-09-19T03:24:12.000Z" }),
        dispatched({ tsIso: "2026-09-19T04:04:12.000Z" }),
        answered({ tsIso: "2026-09-19T04:20:12.000Z" }),
      ],
    }),
  ];

  it("counts a reversed span out of its phase's mean and reports how many there were", () => {
    const reversedRow = turnLedgerRow({
      checkpoint: checkpointOf(),
      completions: [],
      events: [captured({ tsIso: "2026-09-19T00:08:00.000Z" }), answered({ tsIso: "2026-09-19T05:00:00.000Z" })],
    })!;
    const rows = [...rowsOf().filter((row) => row !== undefined), reversedRow];

    const noticed = turnLedgerStats({ rows }).find((entry) => entry.key === "noticed")!;

    expect(noticed.reversed).toBe(1);
    expect(noticed.count).toBe(2);
    expect(noticed.meanSeconds).toBe(15);
  });

  it("averages only the rows that carry a phase, and names its denominator", () => {
    const rows = rowsOf().filter((row) => row !== undefined);

    const stats = turnLedgerStats({ rows });
    const noticed = stats.find((entry) => entry.key === "noticed")!;

    expect(stats.map((entry) => entry.key)).toEqual([...TURN_LEDGER_PHASE_KEYS]);
    expect(noticed.count).toBe(2);
    expect(noticed.meanSeconds).toBe(15);
    expect(noticed.medianSeconds).toBe(15);
  });

  it("excludes a re-dispatched row from the generation-scoped phases and says how many", () => {
    const rows = rowsOf().filter((row) => row !== undefined);

    const investigation = turnLedgerStats({ rows }).find((entry) => entry.key === "investigation")!;

    expect(investigation.count).toBe(1);
    expect(investigation.excludedRedispatched).toBe(1);
    expect(investigation.meanSeconds).toBe(960);
  });

  it("reports a phase no row carries as a count of zero with no figures", () => {
    const rows = turnLedgerGroups({ events: [captured()] }).map((group) =>
      turnLedgerRow({ checkpoint: checkpointOf(), completions: [], events: group.events })!,
    );

    const review = turnLedgerStats({ rows }).find((entry) => entry.key === "review")!;

    expect(review.count).toBe(0);
    expect(review.meanSeconds).toBe(undefined);
    expect(review.medianSeconds).toBe(undefined);
  });

  it("takes the median of an even sample as the mean of its two middles", () => {
    const rows = turnLedgerGroups({
      events: [
        captured(),
        captured({
          channel: "C2",
          messageTs: "1789700000.000100",
          threadTs: "1789700000.000100",
          tsIso: "2026-09-18T02:53:40.000Z",
        }),
      ],
    }).map((group) => turnLedgerRow({ checkpoint: checkpointOf(), completions: [], events: group.events })!);

    const noticed = turnLedgerStats({ rows }).find((entry) => entry.key === "noticed")!;

    expect(rows.map((row) => row.phases.noticed)).toEqual([10, 20]);
    expect(noticed.medianSeconds).toBe(15);
  });

  it("reports every phase as empty over no rows at all", () => {
    const stats = turnLedgerStats({ rows: [] });

    expect(stats.length).toBe(TURN_LEDGER_PHASE_KEYS.length);
    expect(stats.filter((entry) => entry.count !== 0)).toEqual([]);
  });
});
