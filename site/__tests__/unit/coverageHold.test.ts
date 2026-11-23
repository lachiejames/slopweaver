import { describe, expect, it } from "vitest";

import { CoverageHold, MAX_REPAIRS, repairTurnText } from "../../lib/coverageHold";
import type { ReadCoverage, ReadGap } from "../../lib/readCoverage";

const PAGE = "/h/pages/b/index.html";

/** The gap a cut page read leaves. */
const pageGap: ReadGap = {
  continuation: { arguments: { from: 4096, path: PAGE, words: true }, tool: "file_read" },
  source: PAGE,
  what: "bytes 0 to 4096 of 9000 of /h/pages/b/index.html",
};

/** The gap the read resuming {@link pageGap} leaves when it is cut again. */
const laterPageGap: ReadGap = {
  continuation: { arguments: { from: 8000, path: PAGE, words: true }, tool: "file_read" },
  source: PAGE,
  what: "bytes 4096 to 8000 of 9000 of /h/pages/b/index.html",
};

/** The gap a capped Queue list leaves, which no tool reads on. */
const queueGap: ReadGap = { continuation: undefined, source: "action_items", what: "more rows than the list carries" };

const CLAIM = "I've read the whole briefing.";

describe("CoverageHold", () => {
  it("hands an answer that claims nothing, or one made with no read cut", () => {
    const hold = new CoverageHold();
    expect(hold.judge({ text: CLAIM, turnId: "t-answer" })).toEqual({ kind: "hand" });
    hold.answered({
      args: { path: PAGE },
      coverage: { gaps: [pageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-read",
    });
    expect(hold.judge({ text: "The pool ran dry at noon.", turnId: "t-answer" })).toEqual({ kind: "hand" });
  });

  it("sends a claim over a cut read back to read on, naming the call that resumes it", () => {
    const hold = new CoverageHold();
    hold.answered({
      args: { path: PAGE },
      coverage: { gaps: [pageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-read",
    });
    expect(hold.judge({ text: `${CLAIM} It says the pool ran dry.`, turnId: "t-answer" })).toEqual({
      claims: [CLAIM],
      kind: "repair",
      turnText: repairTurnText({ claims: [CLAIM], gaps: [pageGap] }),
    });
  });

  it("closes a gap once a read of that path from where it stopped comes back whole", () => {
    const hold = new CoverageHold();
    hold.answered({
      args: { path: PAGE },
      coverage: { gaps: [pageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-read",
    });
    hold.answered({
      args: { from: 4096, path: PAGE, words: true },
      coverage: { kind: "whole" },
      succeeded: true,
      turnId: "t-read",
    });
    expect(hold.gaps()).toEqual([]);
    expect(hold.judge({ text: CLAIM, turnId: "t-answer" })).toEqual({ kind: "hand" });
  });

  it("keeps a gap standing when the read on from where it stopped was refused, and the refusal beside it", () => {
    const hold = new CoverageHold();
    hold.answered({
      args: { path: PAGE },
      coverage: { gaps: [pageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-read",
    });
    const refusal: ReadGap = { continuation: undefined, source: "file_read", what: "refused: the page moved" };
    hold.answered({
      args: { from: 4096, path: PAGE, words: true },
      coverage: { gaps: [refusal], kind: "refused" },
      succeeded: true,
      turnId: "t-read",
    });
    expect(hold.gaps()).toEqual([pageGap, refusal]);
  });

  it("moves a gap on to where a resuming read was cut again", () => {
    const hold = new CoverageHold();
    hold.answered({
      args: { path: PAGE },
      coverage: { gaps: [pageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-read",
    });
    hold.answered({
      args: { from: 4096, path: PAGE },
      coverage: { gaps: [laterPageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-read",
    });
    expect(hold.gaps()).toEqual([laterPageGap]);
  });

  // A read that skipped ahead to the end certified the part it skipped.
  it("keeps a gap standing when a read of the same path started past it, even one that reached the end", () => {
    const hold = new CoverageHold();
    hold.answered({
      args: { path: PAGE },
      coverage: { gaps: [pageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-read",
    });
    hold.answered({ args: { from: 8000, path: PAGE }, coverage: { kind: "whole" }, succeeded: true, turnId: "t-read" });
    expect(hold.gaps()).toEqual([pageGap]);
    hold.answered({
      args: { from: 6000, path: PAGE },
      coverage: { gaps: [laterPageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-read",
    });
    expect(hold.gaps()).toEqual([pageGap]);
  });

  // A fresh read of the same path, redrawn, closed the old reading's cut.
  it("keeps a page window's gap standing for any read but one of that same reading, and closes it for that one", () => {
    const windowGap: ReadGap = {
      continuation: { arguments: { from: 16_384, path: "/queue", reading: "a-1" }, tool: "read_page" },
      source: "/queue",
      what: "bytes 0 to 16384 of 20000 of the /queue reading",
    };
    const hold = new CoverageHold();
    const read = ({ args, coverage }: { args: Record<string, unknown>; coverage: ReadCoverage }) =>
      hold.answered({ args, coverage, succeeded: true, turnId: "t-read" });
    read({ args: {}, coverage: { gaps: [windowGap], kind: "partial" } });
    read({ args: { path: "/queue" }, coverage: { kind: "whole" } });
    read({ args: { from: 16_384, path: "/queue", reading: "b-2" }, coverage: { kind: "whole" } });
    expect(hold.gaps()).toEqual([windowGap]);
    read({ args: { from: 16_384, path: "/queue", reading: "a-1" }, coverage: { kind: "whole" } });
    expect(hold.gaps()).toEqual([]);
  });

  // A redraw's cut was dropped while the first reading's stood.
  it("keeps a cut of each reading at the same path, so reading on one leaves the other standing", () => {
    const cutOf = ({ reading }: { reading: string }): ReadGap => ({
      continuation: { arguments: { from: 16_384, path: "/queue", reading }, tool: "read_page" },
      source: "/queue",
      what: `bytes 0 to 16384 of 20000 of the /queue reading ${reading}`,
    });
    const hold = new CoverageHold();
    const read = ({ args, coverage }: { args: Record<string, unknown>; coverage: ReadCoverage }) =>
      hold.answered({ args, coverage, succeeded: true, turnId: "t-read" });
    read({ args: {}, coverage: { gaps: [cutOf({ reading: "a-1" })], kind: "partial" } });
    read({ args: {}, coverage: { gaps: [cutOf({ reading: "b-2" })], kind: "partial" } });
    expect(hold.gaps()).toEqual([cutOf({ reading: "a-1" }), cutOf({ reading: "b-2" })]);
    read({ args: { from: 16_384, path: "/queue", reading: "a-1" }, coverage: { kind: "whole" } });
    expect(hold.gaps()).toEqual([cutOf({ reading: "b-2" })]);
    expect(hold.judge({ text: "I've read the whole page.", turnId: "t-read" }).kind).toBe("repair");
  });

  // Two readings of one shape at one path share a `what`, and the
  // send-back named only the first's read on.
  it("names the read on of each reading in a send-back, even two cuts whose words are the same", () => {
    const cutOf = ({ reading }: { reading: string }): ReadGap => ({
      continuation: { arguments: { from: 16_384, path: "/queue", reading }, tool: "read_page" },
      source: "/queue",
      what: "bytes 0 to 16384 of 20000 of the /queue reading",
    });
    const hold = new CoverageHold();
    for (const reading of ["a-1", "b-2"]) {
      hold.answered({
        args: {},
        coverage: { gaps: [cutOf({ reading })], kind: "partial" },
        succeeded: true,
        turnId: "t-read",
      });
    }
    const claim = "I've read the whole page.";
    expect(hold.judge({ text: claim, turnId: "t-read" })).toEqual({
      claims: [claim],
      kind: "repair",
      turnText: repairTurnText({ claims: [claim], gaps: [cutOf({ reading: "a-1" }), cutOf({ reading: "b-2" })] }),
    });
  });

  it("closes a paged record's gap once a read under its pointer from where it stopped comes back whole", () => {
    const hold = new CoverageHold();
    const recordGap: ReadGap = {
      continuation: { arguments: { from: 1200, pointer: "call:abc#7" }, tool: "recall_open" },
      source: "call:abc#7",
      what: "characters 0 to 1200 of the record call:abc#7",
    };
    hold.answered({
      args: { pointer: "call:abc#7" },
      coverage: { gaps: [recordGap], kind: "partial" },
      succeeded: true,
      turnId: "t-read",
    });
    expect(hold.gaps()).toEqual([recordGap]);
    hold.answered({
      args: { from: 1200, pointer: "call:abc#7" },
      coverage: { kind: "whole" },
      succeeded: true,
      turnId: "t-read",
    });
    expect(hold.gaps()).toEqual([]);
  });

  it("keeps a gap no tool reads on until the next ask, and never counts one twice", () => {
    const hold = new CoverageHold();
    hold.answered({ args: {}, coverage: { gaps: [queueGap], kind: "partial" }, succeeded: true, turnId: "t-read" });
    hold.answered({ args: {}, coverage: { kind: "whole" }, succeeded: true, turnId: "t-read" });
    hold.answered({ args: {}, coverage: { gaps: [queueGap], kind: "partial" }, succeeded: true, turnId: "t-read" });
    expect(hold.gaps()).toEqual([queueGap]);
  });

  it(`hands the candid verdict in place of a claim kept past ${String(MAX_REPAIRS)} sends back`, () => {
    const hold = new CoverageHold();
    hold.answered({ args: {}, coverage: { gaps: [queueGap], kind: "partial" }, succeeded: true, turnId: "t-read" });
    expect(hold.judge({ text: CLAIM, turnId: "t-answer" }).kind).toBe("repair");
    expect(hold.judge({ text: CLAIM, turnId: "t-answer" }).kind).toBe("repair");
    expect(hold.judge({ text: CLAIM, turnId: "t-answer" })).toEqual({ claims: [CLAIM], kind: "candid" });
  });

  it("starts afresh when a new ask's turn starts with none running: no gap open, the send-back count back to zero", () => {
    const hold = new CoverageHold();
    hold.turnStarted({ othersRunning: 0, turnId: "t-1" });
    hold.answered({ args: {}, coverage: { gaps: [queueGap], kind: "partial" }, succeeded: true, turnId: "t-read" });
    hold.judge({ text: CLAIM, turnId: "t-answer" });
    hold.sendBackStarted({ turnId: "t-1" });
    hold.judge({ text: CLAIM, turnId: "t-answer" });
    hold.sendBackStarted({ turnId: "t-1" });
    hold.turnEnded({ turnId: "t-read" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-2" });
    expect(hold.gaps()).toEqual([]);
    hold.answered({ args: {}, coverage: { gaps: [queueGap], kind: "partial" }, succeeded: true, turnId: "t-read" });
    expect(hold.judge({ text: CLAIM, turnId: "t-answer" }).kind).toBe("repair");
  });

  it("keeps the cuts through its own send-back's turn, whichever of its start and its answer comes first", () => {
    const answerFirst = new CoverageHold();
    answerFirst.answered({
      args: {},
      coverage: { gaps: [queueGap], kind: "partial" },
      succeeded: true,
      turnId: "t-read",
    });
    answerFirst.judge({ text: CLAIM, turnId: "t-answer" });
    answerFirst.sendBackStarted({ turnId: "t-2" });
    answerFirst.turnStarted({ othersRunning: 0, turnId: "t-2" });
    const startFirst = new CoverageHold();
    startFirst.answered({
      args: {},
      coverage: { gaps: [queueGap], kind: "partial" },
      succeeded: true,
      turnId: "t-read",
    });
    startFirst.judge({ text: CLAIM, turnId: "t-answer" });
    startFirst.turnStarted({ othersRunning: 0, turnId: "t-2" });
    startFirst.sendBackStarted({ turnId: "t-2" });
    expect([answerFirst.gaps(), startFirst.gaps()]).toEqual([[queueGap], [queueGap]]);
  });

  // A foreign turn took the owed count, so the send-back's own start reset.
  it("keeps the cuts when another turn starts and ends before the still-unanswered send-back's own turn starts", () => {
    const hold = new CoverageHold();
    hold.answered({ args: {}, coverage: { gaps: [queueGap], kind: "partial" }, succeeded: true, turnId: "t-read" });
    hold.judge({ text: CLAIM, turnId: "t-answer" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-foreign" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-repair" });
    expect(hold.gaps()).toEqual([queueGap]);
    expect(hold.judge({ text: CLAIM, turnId: "t-answer" }).kind).toBe("repair");
  });

  // A start notice landing after its own turn read wiped that turn's cut.
  it("keeps the cut a turn left before its own start notice landed, and drops an earlier ask's", () => {
    const hold = new CoverageHold();
    hold.answered({ args: {}, coverage: { gaps: [queueGap], kind: "partial" }, succeeded: true, turnId: "t-old" });
    hold.turnEnded({ turnId: "t-old" });
    hold.answered({
      args: { path: PAGE },
      coverage: { gaps: [pageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-1",
    });
    hold.turnStarted({ othersRunning: 0, turnId: "t-1" });
    expect(hold.gaps()).toEqual([pageGap]);
    expect(hold.judge({ text: CLAIM, turnId: "t-answer" }).kind).toBe("repair");
  });

  // Another turn's start dropped a cut whose own answer came later.
  it("judges an answer against its own turn's cuts even after another ask's turn has started", () => {
    const hold = new CoverageHold();
    hold.answered({
      args: { path: PAGE },
      coverage: { gaps: [pageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-1",
    });
    hold.turnEnded({ turnId: "t-1" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-2" });
    const current = hold.gaps();
    const late = hold.judge({ text: CLAIM, turnId: "t-1" });
    const other = hold.judge({ text: CLAIM, turnId: "t-2" });
    expect([current, late.kind, other.kind]).toEqual([[], "repair", "hand"]);
  });

  // A turn that joined another's ask lost that turn's cut once a newer
  // ask began before its answer landed.
  it("judges a late answer against the cuts another turn of its own ask left", () => {
    const hold = new CoverageHold();
    hold.turnStarted({ othersRunning: 0, turnId: "t-1" });
    hold.answered({
      args: { path: PAGE },
      coverage: { gaps: [pageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-1",
    });
    hold.turnStarted({ othersRunning: 1, turnId: "t-2" });
    hold.turnEnded({ turnId: "t-1" });
    hold.turnEnded({ turnId: "t-2" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-3" });
    const late = hold.judge({ text: CLAIM, turnId: "t-2" });
    const fresh = hold.judge({ text: CLAIM, turnId: "t-3" });
    expect([hold.gaps(), late.kind, fresh.kind]).toEqual([[], "repair", "hand"]);
  });

  // A sibling's start notice landing before the reading turn's own
  // began a new ask and stranded the reading turn's cut in the old one.
  it("carries a cut left by a turn not yet seen ending into every new ask", () => {
    const hold = new CoverageHold();
    hold.answered({ args: {}, coverage: { gaps: [queueGap], kind: "partial" }, succeeded: true, turnId: "t-1" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-2" });
    const sibling = hold.judge({ text: CLAIM, turnId: "t-2" });
    hold.turnEnded({ turnId: "t-1" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-3" });
    expect([sibling.kind, hold.gaps()]).toEqual(["repair", [queueGap]]);
  });

  // A second turn's cut on the same path was folded into the first's,
  // and left behind with it once the first ended.
  it("keeps a running turn's cut on a path another, ended turn also left cut", () => {
    const hold = new CoverageHold();
    hold.answered({
      args: { path: PAGE },
      coverage: { gaps: [pageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-a",
    });
    hold.answered({
      args: { from: 6000, path: PAGE },
      coverage: { gaps: [laterPageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-b",
    });
    hold.turnEnded({ turnId: "t-a" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-c" });
    expect([hold.gaps(), hold.judge({ text: CLAIM, turnId: "t-c" }).kind]).toEqual([[laterPageGap], "repair"]);
  });

  // A cut no tool reads on folded into a same-source one a read closed.
  it("keeps a cut no tool reads on after a same-source cut beside it is read on", () => {
    const hold = new CoverageHold();
    const leftOut: ReadGap = { continuation: undefined, source: PAGE, what: "2 briefings left out" };
    hold.answered({
      args: { path: PAGE },
      coverage: { gaps: [pageGap, leftOut], kind: "partial" },
      succeeded: true,
      turnId: "t-1",
    });
    hold.answered({ args: { from: 4096, path: PAGE }, coverage: { kind: "whole" }, succeeded: true, turnId: "t-1" });
    expect([hold.gaps(), hold.judge({ text: CLAIM, turnId: "t-1" }).kind]).toEqual([[leftOut], "repair"]);
  });

  // A read-on that failed, reading nothing, closed the cut it named.
  it("never closes a cut with a read-on that failed", () => {
    const hold = new CoverageHold();
    hold.answered({
      args: { path: PAGE },
      coverage: { gaps: [pageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-1",
    });
    hold.answered({ args: { from: 4096, path: PAGE }, coverage: { kind: "whole" }, succeeded: false, turnId: "t-1" });
    expect([hold.gaps(), hold.judge({ text: CLAIM, turnId: "t-1" }).kind]).toEqual([[pageGap], "repair"]);
  });

  it("leaves an ended turn's cut behind when the next ask begins", () => {
    const hold = new CoverageHold();
    hold.answered({ args: {}, coverage: { gaps: [queueGap], kind: "partial" }, succeeded: true, turnId: "t-1" });
    hold.turnEnded({ turnId: "t-1" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-2" });
    expect([hold.gaps(), hold.judge({ text: CLAIM, turnId: "t-2" }).kind]).toEqual([[], "hand"]);
  });

  it("judges an answer from a turn never seen against every standing cut", () => {
    const hold = new CoverageHold();
    hold.turnStarted({ othersRunning: 0, turnId: "t-1" });
    hold.answered({
      args: { path: PAGE },
      coverage: { gaps: [pageGap], kind: "partial" },
      succeeded: true,
      turnId: "t-1",
    });
    hold.turnEnded({ turnId: "t-1" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-2" });
    const unplaced = hold.judge({ text: CLAIM, turnId: "t-ghost" });
    const fresh = hold.judge({ text: CLAIM, turnId: "t-2" });
    expect([hold.gaps(), unplaced.kind, fresh.kind]).toEqual([[], "repair", "hand"]);
  });

  // A foreign start between the named answer and the named start reset the cuts.
  it("keeps the cuts for the rest of the call when another turn starts before a named send-back's own", () => {
    const hold = new CoverageHold();
    hold.answered({ args: {}, coverage: { gaps: [queueGap], kind: "partial" }, succeeded: true, turnId: "t-read" });
    hold.judge({ text: CLAIM, turnId: "t-answer" });
    hold.sendBackStarted({ turnId: "t-repair" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-foreign" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-repair" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-next" });
    expect(hold.gaps()).toEqual([queueGap]);
    expect(hold.judge({ text: CLAIM, turnId: "t-answer" }).kind).toBe("repair");
  });

  // A `turn/start` error can still start the turn (a known upstream Codex behaviour).
  it("keeps the cuts for the rest of the call once a send-back is answered naming no turn, an error included", () => {
    const hold = new CoverageHold();
    hold.answered({ args: {}, coverage: { gaps: [queueGap], kind: "partial" }, succeeded: true, turnId: "t-read" });
    hold.judge({ text: CLAIM, turnId: "t-answer" });
    hold.sendBackUnbound();
    hold.turnStarted({ othersRunning: 0, turnId: "t-foreign" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-repair" });
    expect(hold.gaps()).toEqual([queueGap]);
    expect(hold.judge({ text: CLAIM, turnId: "t-answer" }).kind).toBe("repair");
  });

  // A start the console stopped waiting for may still run, and reset its own cuts.
  it("keeps the cuts through a send-back whose start was never answered, and resets after one never written", () => {
    const unanswered = new CoverageHold();
    unanswered.answered({
      args: {},
      coverage: { gaps: [queueGap], kind: "partial" },
      succeeded: true,
      turnId: "t-read",
    });
    unanswered.judge({ text: CLAIM, turnId: "t-answer" });
    unanswered.turnStarted({ othersRunning: 0, turnId: "t-late" });
    const refused = new CoverageHold();
    refused.answered({ args: {}, coverage: { gaps: [queueGap], kind: "partial" }, succeeded: true, turnId: "t-read" });
    refused.judge({ text: CLAIM, turnId: "t-answer" });
    refused.sendBackRefused();
    refused.turnEnded({ turnId: "t-read" });
    refused.turnStarted({ othersRunning: 0, turnId: "t-next" });
    expect([unanswered.gaps(), refused.gaps()]).toEqual([[queueGap], []]);
  });

  it("keeps the cuts when a turn starts while another runs, or a running turn's start is replayed", () => {
    const hold = new CoverageHold();
    hold.turnStarted({ othersRunning: 0, turnId: "t-1" });
    hold.answered({ args: {}, coverage: { gaps: [queueGap], kind: "partial" }, succeeded: true, turnId: "t-read" });
    hold.turnStarted({ othersRunning: 1, turnId: "t-2" });
    hold.turnStarted({ othersRunning: 0, turnId: "t-1" });
    expect(hold.gaps()).toEqual([queueGap]);
  });
});

describe("repairTurnText", () => {
  it("quotes the held claim and names each cut read with its call, or that none reads on", () => {
    const text = repairTurnText({ claims: [CLAIM], gaps: [pageGap, queueGap] });
    expect(text).toBe(
      [
        `The console held your last answer back from the voice: it says "${CLAIM}" while these reads stand cut:`,
        `- bytes 0 to 4096 of 9000 of ${PAGE}: read on with file_read {"from":4096,"path":"${PAGE}","words":true}`,
        "- more rows than the list carries: no tool reads the rest",
        "Read on with the call named for the part your answer rests on, as far as it needs and no further, then answer " +
          "again. Where no tool reads the rest, answer again saying plainly which part you read. Do not repeat the held " +
          "answer.",
      ].join("\n"),
    );
  });
});
