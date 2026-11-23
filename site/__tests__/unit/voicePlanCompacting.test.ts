/*
 * A Codex turn compacting the voice's thread, replayed through the orb's fold. A compaction sends nothing until it
 * ends: a measured one ran 91s, the orb drew a stall at 35s, and the owner read the voice as asleep. So it reads
 * "compacting" until COMPACTION_STALL_MS, stalls with the nudge only past it, and its end hands back ordinary work.
 */
import { describe, expect, it } from "vitest";

import { turnProgressOf } from "../../lib/talkPlanTurns";
import {
  type ActivityInput,
  COMPACTION_STALL_MS,
  foldActivity,
  NO_ACTIVITY,
  STALL_MS,
  type VoiceActivity,
  voiceStatusOf,
} from "../../lib/voiceActivity";

type Script = readonly (readonly [number, ActivityInput])[];

function play({ script }: { script: Script }): VoiceActivity {
  return script.reduce<VoiceActivity>(
    (activity, [nowMs, input]) => foldActivity({ activity, input, nowMs }),
    NO_ACTIVITY,
  );
}

/** What the orb shows at `nowMs` in a quiet room: its phase, headline, detail and nudge. */
function shownAt({ activity, nowMs }: { activity: VoiceActivity; nowMs: number }): readonly unknown[] {
  const status = voiceStatusOf({ activity, link: "live", micLevel: 0, micRms: 0, muted: false, nowMs, outputLevel: 0 });
  return [status.phase, status.headline, status.detail, status.nudge];
}

/** The owner asked, a Codex turn started, and the thread began compacting at once. */
const STARTED_AT = 2_000;
const COMPACTING: Script = [
  [1_000, { kind: "heard" }],
  [STARTED_AT, { kind: "codex-turn", phase: "started", turnId: "t-1" }],
  [STARTED_AT, { kind: "codex-turn", phase: "progress", step: { kind: "compacting" }, turnId: "t-1" }],
];

describe("turnProgressOf over a context compaction", () => {
  const params = { threadId: "thread-1", turnId: "t-1" };
  const forwarded = ({
    method,
    running,
    sentMs,
  }: {
    method: string;
    running: ReadonlySet<string>;
    sentMs: Map<string, number>;
  }) =>
    turnProgressOf({
      method,
      nowMs: 1_000,
      params: { ...params, item: { id: "c-1", type: "contextCompaction" } },
      running,
      sentMs,
      threadId: "thread-1",
    });

  // A compaction shorter than the progress throttle still ends on the page, else the orb says compacting on.
  it("forwards its start and its end inside the throttle, and nothing for a turn not running", () => {
    const running = new Set(["t-1"]);
    const sentMs = new Map([["t-1", 900]]);
    expect([
      forwarded({ method: "item/started", running, sentMs }),
      forwarded({ method: "item/completed", running, sentMs }),
      forwarded({ method: "item/started", running: new Set(), sentMs: new Map() }),
    ]).toEqual([
      { kind: "codex-turn", phase: "progress", step: { kind: "compacting" }, turnId: "t-1" },
      { kind: "codex-turn", phase: "progress", step: { kind: "working" }, turnId: "t-1" },
      undefined,
    ]);
  });
});

describe("a Codex turn compacting the voice's thread", () => {
  it("reads compacting until COMPACTION_STALL_MS, and stalls with the interrupt nudge only from then", () => {
    const activity = play({ script: COMPACTING });
    expect([
      shownAt({ activity, nowMs: STARTED_AT }),
      shownAt({ activity, nowMs: STARTED_AT + STALL_MS }),
      shownAt({ activity, nowMs: STARTED_AT + COMPACTION_STALL_MS - 1 }),
      shownAt({ activity, nowMs: STARTED_AT + COMPACTION_STALL_MS }),
    ]).toEqual([
      ["working", "compacting", "compacting the conversation · 0s", undefined],
      ["working", "compacting", "compacting the conversation · 35s", undefined],
      ["working", "compacting", "compacting the conversation · 179s", undefined],
      ["stalled", "no update", "compacting the conversation · no update for 180s", "interrupt"],
    ]);
  });

  // Progress naming no step keeps the last, so without the end's own step the orb would say compacting on.
  it("hands back ordinary work when the compaction ends, which stalls at STALL_MS again", () => {
    const endedAt = STARTED_AT + 100_000;
    const activity = play({
      script: [
        ...COMPACTING,
        [endedAt, { kind: "codex-turn", phase: "progress", step: { kind: "working" }, turnId: "t-1" }],
      ],
    });
    expect([
      shownAt({ activity, nowMs: endedAt }),
      shownAt({ activity, nowMs: endedAt + STALL_MS - 1 }),
      shownAt({ activity, nowMs: endedAt + STALL_MS }),
    ]).toEqual([
      ["working", "working", "working · 100s", undefined],
      ["working", "working", "working · 134s", undefined],
      ["stalled", "no update", "working · no update for 135s", "interrupt"],
    ]);
  });
});
