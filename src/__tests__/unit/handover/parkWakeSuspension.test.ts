/**
 * The `park-wake-suspended` projection: a suspension holds a standing park's wake only while the owner's question is open
 * and nothing since touches what the run waits on, bound to the park by journal position, never by matching text.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { parkAsItWaits, parkedResumeLines, straySuspendReason } from "../../../handover/parked.js";
import { parkWakeSuspension } from "../../../handover/parkWakeSuspension.js";

const QUESTION = "Keep the backup key wrapped?";
const ASKED_ISO = "2026-10-04T02:00:00.000Z";
const WAKE = { kind: "checks", number: 7, repo: "acme/widgets" } as const;

const STARTED: RunEvent = { atIso: "2026-10-04T01:00:00.000Z", branch: "b", docHash: "h", kind: "started" };
const LAUNCHED: RunEvent = {
  atIso: "2026-10-04T01:00:01.000Z",
  kind: "launched",
  pid: 1,
  sessionId: "s",
  worktree: "/wt",
};
const ASKED: RunEvent = { atIso: ASKED_ISO, kind: "question", question: QUESTION };
const PARKED: RunEvent = {
  atIso: "2026-10-04T03:00:00.000Z",
  branch: "b",
  kind: "parked",
  question: QUESTION,
  screenTail: "❯ ",
  sessionId: "s",
  wake: WAKE,
  workspaceRef: "workspace:1",
  worktree: "/wt",
};
/** The park sits at index 3 of {@link BASE}. */
const BASE: readonly RunEvent[] = [STARTED, LAUNCHED, ASKED, PARKED];

/** A suspension of the park at `parkIndex` on {@link QUESTION}, judged over {@link BASE}'s four lines. */
function suspended({ judgedLength = 4, parkIndex = 3, question = QUESTION } = {}): RunEvent {
  return {
    atIso: "2026-10-04T04:00:00.000Z",
    judgedLength,
    kind: "park-wake-suspended",
    parkIndex,
    question,
    questionAskedIso: ASKED_ISO,
    why: "acme/widgets#7 (b) merged",
  };
}

describe("parkWakeSuspension", () => {
  it("holds the wake while the question is open and nothing since touches it", () => {
    expect(parkWakeSuspension({ events: [...BASE, suspended()], parkIndex: 3 })?.atIso).toBe(
      "2026-10-04T04:00:00.000Z",
    );
  });

  it("is absent when no suspension names the park's position", () => {
    expect(parkWakeSuspension({ events: [...BASE, suspended({ parkIndex: 1 })], parkIndex: 3 })).toBe(undefined);
  });

  it("lifts on the owner's answer", () => {
    const answered: RunEvent = { answer: "yes", atIso: "2026-10-04T05:00:00.000Z", kind: "answered" };
    expect(parkWakeSuspension({ events: [...BASE, suspended(), answered], parkIndex: 3 })).toBe(undefined);
  });

  it("lifts on a message queued for the seat, though the question stays open", () => {
    const said: RunEvent = { atIso: "2026-10-04T05:00:00.000Z", kind: "said", message: "also rebase" };
    expect(parkWakeSuspension({ events: [...BASE, suspended(), said], parkIndex: 3 })).toBe(undefined);
  });

  // the append's read and write are not atomic, so a line can land between them and sit BEFORE the suspension.
  it("never holds over a lifting line that landed between the wake's judgement and its write", () => {
    const shaped: RunEvent = {
      atIso: "2026-10-04T03:30:00.000Z",
      kind: "question-reconfirmed",
      question: QUESTION,
      stillReal: "still",
    };
    expect(parkWakeSuspension({ events: [...BASE, shaped, suspended()], parkIndex: 3 })).toBe(undefined);
  });

  it("never holds over a message queued for the seat before it, wherever the wake judged", () => {
    const said: RunEvent = { atIso: "2026-10-04T03:30:00.000Z", kind: "said", message: "also rebase" };
    expect(parkWakeSuspension({ events: [...BASE, said, suspended({ judgedLength: 5 })], parkIndex: 3 })).toBe(
      undefined,
    );
  });

  it("holds over the question the wake had already judged, inside its judged length", () => {
    expect(parkWakeSuspension({ events: [...BASE, suspended()], parkIndex: 3 })?.judgedLength).toBe(4);
  });

  it("stays lifted after a correction away and back to the same text", () => {
    const away: RunEvent = { atIso: "2026-10-04T05:00:00.000Z", kind: "question-corrected", question: "B?", why: "w" };
    const back: RunEvent = {
      atIso: "2026-10-04T05:00:01.000Z",
      kind: "question-corrected",
      question: QUESTION,
      why: "w",
    };
    expect(parkWakeSuspension({ events: [...BASE, suspended(), away, back], parkIndex: 3 })).toBe(undefined);
  });

  it("ignores a line that changes nothing the run waits on", () => {
    const note: RunEvent = {
      atIso: "2026-10-04T05:00:00.000Z",
      judgedLength: 10,
      kind: "park-wake-suspended",
      parkIndex: 9,
      question: QUESTION,
      questionAskedIso: ASKED_ISO,
      why: "w",
    };
    expect(parkWakeSuspension({ events: [...BASE, suspended(), note], parkIndex: 3 })?.parkIndex).toBe(3);
  });
});

describe("parkAsItWaits", () => {
  it("strips the wake off a suspended park and keeps the park standing", () => {
    const waiting = parkAsItWaits({ events: [...BASE, suspended()] })!;
    expect([waiting.parkIndex, waiting.parked.wake, waiting.parked.atIso, waiting.suspension?.kind]).toEqual([
      3,
      undefined,
      "2026-10-04T03:00:00.000Z",
      "park-wake-suspended",
    ]);
  });

  it("keeps the wake on a park with no suspension", () => {
    expect(parkAsItWaits({ events: BASE })!.parked.wake).toEqual(WAKE);
  });

  it("says in the resume block that the wake is suspended and what lifts it", () => {
    const lines = parkedResumeLines({ events: [...BASE, suspended()], slug: "s" }).join("\n");
    expect(lines).toContain("wake suspended 2026-10-04T04:00:00.000Z: acme/widgets#7 (b) merged");
    expect(lines).toContain("reseats itself once the owner's question is answered or withdrawn");
  });
});

describe("straySuspendReason", () => {
  it("passes a suspension naming the standing park and the open question", () => {
    expect(straySuspendReason({ event: suspended(), events: BASE })).toBe(undefined);
  });

  it("refuses one naming another position", () => {
    expect(straySuspendReason({ event: suspended({ parkIndex: 2 }), events: BASE })).toBe(
      "no park stands at position 2, so there is no wake this suspends",
    );
  });

  it("refuses one written once the question was answered", () => {
    const answered: RunEvent = { answer: "yes", atIso: "2026-10-04T03:30:00.000Z", kind: "answered" };
    expect(straySuspendReason({ event: suspended(), events: [...BASE, answered] })).toBe(
      "the answered line at 2026-10-04T03:30:00.000Z came after the park, and only a reseat carries it to the seat",
    );
  });

  it("refuses one claiming to have judged more lines than the journal holds", () => {
    expect(straySuspendReason({ event: suspended({ judgedLength: 5 }), events: BASE })).toBe(
      "it names a judged length of 5 lines, outside the park and the 4 the journal holds",
    );
  });

  it("refuses one over a run that never asked anything", () => {
    expect(
      straySuspendReason({ event: suspended({ judgedLength: 3, parkIndex: 2 }), events: [STARTED, LAUNCHED, PARKED] }),
    ).toBe("no question is open, so the wake has work to wake for and nothing to wait on");
  });

  it("refuses one over a ruling since the park, though the question still stands", () => {
    const ruling: RunEvent = { anchor: "talk:a", atIso: "2026-10-04T03:30:00.000Z", kind: "ruling", ruling: "yes" };
    expect(straySuspendReason({ event: suspended(), events: [...BASE, ruling] })).toContain(
      "the ruling line at 2026-10-04T03:30:00.000Z came after the park",
    );
  });

  it("refuses one naming a question other than the open one", () => {
    expect(straySuspendReason({ event: suspended({ question: "Another?" }), events: BASE })).toContain(
      "is not the one this names",
    );
  });
});
