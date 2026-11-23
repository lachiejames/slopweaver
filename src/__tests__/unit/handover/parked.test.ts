import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { runStateOf } from "../../../handover/ledger.js";
import { activeParkedCheckpoint, latestParkedCheckpoint, parkedResumeLines } from "../../../handover/parked.js";
import {
  decodeParkedDrafts,
  PARK_SCREEN_LINES,
  PARK_SCREEN_TAIL_MAX_CHARS,
  type ParkedDraft,
  parkScreenTail,
} from "../../../handover/parkedEvent.js";
import type { ParkWake } from "../../../handover/parkWake.js";
import { runOwnership, writerOf } from "../../../handover/runOwner.js";

const WRITER = "89e81284-ee20-4e94-8896-6c17a2d10a50";
const OTHER = "c28007f7-aa86-4925-ab52-14566f5daea2";
const QUESTION = "Which provenance label does the card show?";

const STARTED: RunEvent = {
  atIso: "2026-10-04T01:00:00.000Z",
  branch: "card-provenance",
  docHash: "h",
  kind: "started",
};
const LAUNCHED: RunEvent = {
  atIso: "2026-10-04T01:00:01.000Z",
  kind: "launched",
  pid: 4242,
  sessionId: WRITER,
  worktree: "/wt/card-provenance",
};
const ASKED: RunEvent = { atIso: "2026-10-04T02:00:00.000Z", kind: "question", question: QUESTION };

const CLAIMED_BY_OTHER: RunEvent = {
  atIso: "2026-10-04T02:30:00.000Z",
  host: "claude-code",
  kind: "claimed",
  pid: 77,
  sessionId: OTHER,
  why: "taking it over",
  worktree: "/wt/card-provenance",
};

/** A `parked` event written by the session named, at the instant named — on {@link QUESTION} unless between turns. */
function parked({
  sessionId = WRITER,
  atIso = "2026-10-04T03:00:00.000Z",
  betweenTurns = false,
  drafts,
  wake,
}: {
  sessionId?: string;
  atIso?: string;
  betweenTurns?: boolean;
  drafts?: readonly ParkedDraft[];
  wake?: ParkWake;
} = {}): RunEvent {
  return {
    atIso,
    branch: "card-provenance",
    ...(drafts === undefined ? {} : { drafts }),
    kind: "parked",
    ...(betweenTurns ? {} : { question: QUESTION }),
    screenTail: "⏺ Recorded the question.\n❯ ",
    sessionId,
    ...(wake === undefined ? {} : { wake }),
    workspaceRef: "workspace:238",
    worktree: "/wt/card-provenance",
  };
}

const CHECKS_WAKE: ParkWake = { kind: "checks", number: 9877, repo: "acme/acme-admin" };

/** A `park-cleared` line naming the journal position named, as `handover wake` writes one. */
function cleared({ parkIndex }: { parkIndex: number }): RunEvent {
  return {
    atIso: "2026-10-04T04:00:00.000Z",
    kind: "park-cleared",
    parkIndex,
    why: "the ask is settled answered, so cmux spawn refuses it on every wake",
  };
}

describe("parkScreenTail", () => {
  it("keeps only the last lines a reseat needs, without the trailing blank rows", () => {
    const screen = [...Array.from({ length: PARK_SCREEN_LINES + 5 }, (_, i) => `line ${String(i)}`), "", ""].join("\n");
    const tail = parkScreenTail({ screen });
    expect(tail.split("\n")).toHaveLength(PARK_SCREEN_LINES);
    expect(tail.split("\n")[0]).toBe("line 5");
  });

  it("caps an oversized tail at the schema's limit, keeping its end", () => {
    const tail = parkScreenTail({ screen: `${"x".repeat(PARK_SCREEN_TAIL_MAX_CHARS)}END` });
    expect(tail).toHaveLength(PARK_SCREEN_TAIL_MAX_CHARS);
    expect(tail.endsWith("END")).toBe(true);
  });

  it("reads an empty screen as an empty tail", () => {
    expect(parkScreenTail({ screen: "\n\n" })).toBe("");
  });
});

describe("a parked run's phase and owner", () => {
  it("stays waiting on the owner with its question open", () => {
    const run = runStateOf({ events: [STARTED, LAUNCHED, ASKED, parked()] });
    expect(run.phase).toBe("waiting-on-owner");
    expect(run.openQuestion).toBe(QUESTION);
  });

  it("releases the writer, so reap leaves it and a reseat claims it without --force", () => {
    const events = [STARTED, LAUNCHED, ASKED, parked()];
    expect(writerOf({ events })).toBeUndefined();
    const ownership = runOwnership({ events, sessionId: OTHER });
    expect(ownership.kind).toBe("released");
  });

  it("does NOT release a writer the park did not name", () => {
    const events = [STARTED, LAUNCHED, ASKED, parked({ sessionId: OTHER })];
    expect(writerOf({ events })!.sessionId).toBe(WRITER);
  });
});

describe("activeParkedCheckpoint", () => {
  it("is the park while nothing has ended the wait", () => {
    expect(activeParkedCheckpoint({ events: [STARTED, LAUNCHED, ASKED, parked()] })!.workspaceRef).toBe(
      "workspace:238",
    );
  });

  it("survives a ruling, which is what a reseat is for", () => {
    const ruling: RunEvent = {
      anchor: "transcript:x#y",
      atIso: "2026-10-04T04:00:00.000Z",
      kind: "ruling",
      ruling: "use the PR",
    };
    expect(activeParkedCheckpoint({ events: [STARTED, LAUNCHED, ASKED, parked(), ruling] })!.atIso).toBe(
      "2026-10-04T03:00:00.000Z",
    );
  });

  // The seat is still closed after the owner answers, and their answer is what a reseat is for.
  it("survives the owner's answer, because the seat is still closed", () => {
    const answered: RunEvent = { answer: "the PR", atIso: "2026-10-04T04:00:00.000Z", kind: "answered" };
    expect(activeParkedCheckpoint({ events: [STARTED, LAUNCHED, ASKED, parked(), answered] })!.atIso).toBe(
      "2026-10-04T03:00:00.000Z",
    );
  });

  it("carries its wake, and a spawn's dispatch still ends it", () => {
    const waking = parked({ betweenTurns: true, wake: CHECKS_WAKE });
    const dispatched: RunEvent = {
      atIso: "2026-10-04T04:00:00.000Z",
      by: "handover wake",
      kind: "dispatched",
      target: "workspace:290",
    };
    expect(activeParkedCheckpoint({ events: [STARTED, LAUNCHED, waking] })!.wake).toEqual(CHECKS_WAKE);
    expect(activeParkedCheckpoint({ events: [STARTED, LAUNCHED, waking, dispatched] })).toBeUndefined();
  });

  it("is a park between turns, with no question open", () => {
    const between = parked({ betweenTurns: true });
    expect(activeParkedCheckpoint({ events: [STARTED, LAUNCHED, between] })!.workspaceRef).toBe("workspace:238");
  });

  // The journal takes no lock, so a claim can land between a park's read and its append.
  it("is NOT a park that landed after another session claimed the run", () => {
    const events = [STARTED, LAUNCHED, ASKED, CLAIMED_BY_OTHER, parked()];
    expect(activeParkedCheckpoint({ events })).toBeUndefined();
    expect(writerOf({ events })!.sessionId).toBe(OTHER);
  });

  it("keeps the first park when a second lands on the already-released run", () => {
    const events = [STARTED, LAUNCHED, ASKED, parked(), parked({ atIso: "2026-10-04T03:30:00.000Z" })];
    expect(activeParkedCheckpoint({ events })!.atIso).toBe("2026-10-04T03:00:00.000Z");
  });

  it("ends when a session takes the run back", () => {
    const relaunched: RunEvent = { ...LAUNCHED, atIso: "2026-10-04T04:00:00.000Z", sessionId: OTHER };
    expect(activeParkedCheckpoint({ events: [STARTED, LAUNCHED, ASKED, parked(), relaunched] })).toBeUndefined();
  });

  // Measured: a reseat into a worktree older than the `parked` kind could not claim, so the park
  // stood over an open seat and `handover park` refused to close that seat as "parked already".
  it("ends when a spawn seats the run again, before that seat has claimed it", () => {
    const reseated: RunEvent = {
      atIso: "2026-10-04T04:39:47.197Z",
      by: "chair",
      kind: "dispatched",
      target: "workspace:289",
    };
    expect(activeParkedCheckpoint({ events: [STARTED, LAUNCHED, ASKED, parked(), reseated] })).toBeUndefined();
  });

  it("survives the open question being withdrawn, because the seat is still closed", () => {
    const withdrawn: RunEvent = {
      atIso: "2026-10-04T04:00:00.000Z",
      kind: "question-withdrawn",
      question: QUESTION,
      why: "dissolved",
    };
    expect(activeParkedCheckpoint({ events: [STARTED, LAUNCHED, ASKED, parked(), withdrawn] })!.atIso).toBe(
      "2026-10-04T03:00:00.000Z",
    );
  });

  it("ends when the run finishes", () => {
    const finished: RunEvent = { atIso: "2026-10-04T04:00:00.000Z", kind: "finished", residue: [] };
    expect(activeParkedCheckpoint({ events: [STARTED, LAUNCHED, ASKED, parked(), finished] })).toBeUndefined();
  });

  it("ends on a park-cleared naming its position, and on no other position", () => {
    const events = [STARTED, LAUNCHED, ASKED, parked({ wake: CHECKS_WAKE })];
    expect(activeParkedCheckpoint({ events: [...events, cleared({ parkIndex: 3 })] })).toBeUndefined();
    expect(activeParkedCheckpoint({ events: [...events, cleared({ parkIndex: 2 })] })).toBe(events[3]);
  });

  it("leaves a later park standing when a stale park-cleared names the one it replaced", () => {
    const later = parked({ atIso: "2026-10-04T05:00:00.000Z", wake: CHECKS_WAKE });
    const events = [STARTED, LAUNCHED, ASKED, parked(), cleared({ parkIndex: 3 }), later, cleared({ parkIndex: 3 })];
    expect(activeParkedCheckpoint({ events })).toBe(later);
  });

  it("moves neither the phase nor the owner when a park is cleared", () => {
    const events = [STARTED, LAUNCHED, ASKED, parked()];
    const after = [...events, cleared({ parkIndex: 3 })];
    expect(runStateOf({ events: after }).phase).toBe(runStateOf({ events }).phase);
    expect(runOwnership({ events: after, sessionId: undefined })).toEqual(
      runOwnership({ events, sessionId: undefined }),
    );
  });

  it("does not reach back past a new cycle", () => {
    const restarted: RunEvent = { ...STARTED, atIso: "2026-10-04T05:00:00.000Z" };
    expect(activeParkedCheckpoint({ events: [STARTED, LAUNCHED, ASKED, parked(), restarted] })).toBeUndefined();
    expect(latestParkedCheckpoint({ events: [STARTED, LAUNCHED, ASKED, parked(), restarted] })).toBeUndefined();
  });
});

describe("parkedResumeLines", () => {
  it("prints nothing for a run that never parked", () => {
    expect(parkedResumeLines({ events: [STARTED, LAUNCHED, ASKED], slug: "card-provenance" })).toEqual([]);
  });

  it("names the worktree, branch, question, last screen and the reseat while parked", () => {
    expect(parkedResumeLines({ events: [STARTED, LAUNCHED, ASKED, parked()], slug: "card-provenance" })).toEqual([
      "PARKED 2026-10-04T03:00:00.000Z — workspace:238 was closed at rest; the seat is NOT open",
      "  worktree: /wt/card-provenance (rebuilt from the branch if it is gone)",
      "  branch:   card-provenance",
      `  waited on: ${QUESTION}`,
      "  last screen before it closed:",
      "    ⏺ Recorded the question.",
      "    ❯ ",
      "  reseat when wanted: slopweaver cmux spawn card-provenance — the seat then claims and resumes here",
    ]);
  });

  it("prints every draft the seat held, in full, and says when nothing was open", () => {
    const drafts: readonly ParkedDraft[] = [
      { kind: "ask-action", text: "Shipping the label as PR." },
      { id: "sd-465c30f6", kind: "slack-draft", text: "hey <@U1>\nare you ok with this?" },
    ];
    const lines = parkedResumeLines({
      events: [STARTED, LAUNCHED, parked({ betweenTurns: true, drafts })],
      slug: "card-provenance",
    });
    expect(lines.slice(3, 10)).toEqual([
      "  waited on: nothing open — it stopped between turns",
      "  drafts it held, unsent:",
      "    the question's drafted message:",
      "      Shipping the label as PR.",
      "    slack draft sd-465c30f6:",
      "      hey <@U1>",
      "      are you ok with this?",
    ]);
  });

  it("names a between-turns park's wake in place of an open question, and that the tick reseats it", () => {
    const lines = parkedResumeLines({
      events: [STARTED, LAUNCHED, parked({ betweenTurns: true, wake: CHECKS_WAKE })],
      slug: "card-provenance",
    });
    expect([lines[3], lines.at(-1)]).toEqual([
      "  wakes on:  CI finishing on acme/acme-admin#9877, or its merge or close",
      "  reseats itself: the supervisor tick's `handover wake` runs `cmux spawn card-provenance` once its wake is due",
    ]);
  });

  it("prints the open question and a clock wake together when a park carries both", () => {
    const wake: ParkWake = { atIso: "2026-10-15T03:13:00Z", kind: "at" };
    const lines = parkedResumeLines({ events: [STARTED, LAUNCHED, ASKED, parked({ wake })], slug: "card-provenance" });
    expect(lines.slice(3, 5)).toEqual([`  waited on: ${QUESTION}`, "  wakes at:  2026-10-15T03:13:00Z"]);
  });

  it("says a cleared park's wake was retired without a reseat, and why, instead of how to reseat it", () => {
    const lines = parkedResumeLines({
      events: [STARTED, LAUNCHED, parked({ betweenTurns: true, wake: CHECKS_WAKE }), cleared({ parkIndex: 2 })],
      slug: "card-provenance",
    });
    expect([lines[0], lines.at(-1)]).toEqual([
      "PARKED 2026-10-04T03:00:00.000Z — workspace:238 was closed at rest; its wake was cleared at 2026-10-04T04:00:00.000Z without a reseat",
      "  wake cleared: the ask is settled answered, so cmux spawn refuses it on every wake",
    ]);
  });

  // a park naming no holder never stood, so a hand-edited clear naming it retired nothing, and the
  // block reads exactly as it would with no clear at all.
  it("reads a clear naming a park that never stood as no clear at all", () => {
    const events = [STARTED, LAUNCHED, parked({ betweenTurns: true, sessionId: OTHER, wake: CHECKS_WAKE })];
    const slug = "card-provenance";
    const withClear = parkedResumeLines({ events: [...events, cleared({ parkIndex: 2 })], slug });
    expect(withClear).toEqual(parkedResumeLines({ events, slug }));
    expect(withClear.at(-1)).not.toBe(
      "  wake cleared: the ask is settled answered, so cmux spawn refuses it on every wake",
    );
  });

  it("says the seat was reseated once a session claims, and still names where it stood", () => {
    const lines = parkedResumeLines({
      events: [STARTED, LAUNCHED, ASKED, parked(), { ...CLAIMED_BY_OTHER, atIso: "2026-10-04T04:00:00.000Z" }],
      slug: "card-provenance",
    });
    expect(lines[0]).toBe(
      "PARKED 2026-10-04T03:00:00.000Z — workspace:238 was closed at rest; it has since been reseated",
    );
    expect(lines[1]).toBe("  worktree: /wt/card-provenance (rebuilt from the branch if it is gone)");
  });
});

describe("decodeParkedDrafts", () => {
  it("reads both kinds and drops a member that is not a whole draft", () => {
    const raw = [
      { kind: "ask-action", text: "a" },
      { id: "sd-1", kind: "slack-draft", text: "b" },
      { kind: "slack-draft", text: "no id" },
      { kind: "ask-action" },
      "loose",
    ];
    expect(decodeParkedDrafts({ raw })).toEqual([
      { kind: "ask-action", text: "a" },
      { id: "sd-1", kind: "slack-draft", text: "b" },
    ]);
  });

  it("reads a line older than the field as carrying no list", () => {
    expect(decodeParkedDrafts({ raw: undefined })).toBe(undefined);
  });
});
