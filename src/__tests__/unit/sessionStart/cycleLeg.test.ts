import { describe, expect, it } from "vitest";

import type { CycleProposal } from "../../../cycle/types.js";
import {
  cycleBackground,
  cycleEvidence,
  cycleItem,
  cycleLeg,
  cycleReadings,
  cycleWho,
  DRIFT_BY_ACTION,
  movedAtIso,
  PRIORITY_READINGS,
} from "../../../sessionStart/cycleLeg.js";
import { rankAll } from "../../../sessionStart/rank.js";

const NOW = "2026-08-30T12:00:00.000Z";

/** `dated: false` builds the one real case with no stated instant — a project that has never been updated. */
const proposal = ({ dated = true, ...over }: Partial<CycleProposal> & { dated?: boolean } = {}): CycleProposal => ({
  action: "close-with-comment",
  daysSinceMoved: 10,
  ...(dated ? { movedAtIso: "2026-08-20T12:00:00.000Z" } : {}),
  evidence: [{ fact: "the pull request attached to this ticket is merged", url: "https://github.com/o/r/pull/1" }],
  headline: "AAA-1 has a merged pull request and is still open.",
  oneWordReplies: ["close", "keep", "later"],
  subject: "AAA-1",
  url: "https://linear.app/w/issue/AAA-1",
  ...over,
});

describe("movedAtIso", () => {
  it("takes the subject's own instant, so it does not move when the run does", () => {
    expect(movedAtIso({ proposal: proposal() })).toBe("2026-08-20T12:00:00.000Z");
  });

  it("is the same instant on two runs an hour apart, which is what lock-in keys on", () => {
    const first = cycleItem({ proposal: proposal() })!;
    const second = cycleItem({ proposal: proposal() })!;
    expect(second.whenIso).toBe(first.whenIso);
  });

  it("refuses a proposal whose source states no instant, rather than inventing one", () => {
    expect(movedAtIso({ proposal: proposal({ dated: false }) })).toBeUndefined();
  });

  it("refuses an unparseable instant", () => {
    expect(movedAtIso({ proposal: proposal({ movedAtIso: "not-a-date" }) })).toBeUndefined();
  });
});

describe("cycleItem", () => {
  it("carries the four mandatory fields from the proposal", () => {
    const item = cycleItem({ proposal: proposal() })!;
    expect(item.doneWhen).toBe("AAA-1 has a merged pull request and is still open.");
    expect(item.nativeId).toBe("AAA-1");
    expect(item.source).toBe("linear");
    expect(item.where).toBe("https://linear.app/w/issue/AAA-1");
    expect(item.whenIso).toBe("2026-08-20T12:00:00.000Z");
    expect(item.who).toBe("your own cycle");
  });

  it("states the proposal class in plain words rather than as its slug", () => {
    expect(cycleItem({ proposal: proposal() })!.state).toBe("open, but the work is done");
  });

  it("drops a proposal whose instant cannot be derived, rather than rendering a blank cell", () => {
    const never = proposal({ action: "project-update", dated: false, daysSinceMoved: Number.MAX_SAFE_INTEGER });
    expect(cycleItem({ proposal: never })).toBeUndefined();
  });
});

describe("cycleWho", () => {
  it("names the owner's own cycle for a close proposal, because nobody asked", () => {
    expect(cycleWho({ action: "close-with-comment" })).toBe("your own cycle");
  });

  it("names the project for an overdue update, which is what actually owes one", () => {
    expect(cycleWho({ action: "project-update" })).toBe("a project you lead");
  });
});

describe("cycleEvidence", () => {
  it("grades a close proposal's evidence as a provider fact that shows the work resolved", () => {
    const traced = cycleEvidence({ proposal: proposal() });
    expect(traced).toHaveLength(1);
    expect(traced[0]!.grade).toBe("provider-fact");
    expect(traced[0]!.showsResolved).toBe(true);
    expect(traced[0]!.source).toBe("https://github.com/o/r/pull/1");
  });

  it("grades a trace proposal as a machine account, because its own words say it settles nothing", () => {
    const traced = cycleEvidence({
      proposal: proposal({
        action: "trace",
        evidence: [{ fact: "this pull request was closed without merging", url: "https://github.com/o/r/pull/2" }],
      }),
    });
    expect(traced[0]!.grade).toBe("machine-account");
    expect(traced[0]!.showsResolved).toBe(false);
  });

  it("forwards every piece, so a close arrives with all the facts that closed it", () => {
    const traced = cycleEvidence({
      proposal: proposal({
        evidence: [
          { fact: "the pull request is merged", url: "https://github.com/o/r/pull/1" },
          { fact: "the ticket has not moved for 10 days", url: "https://linear.app/w/issue/AAA-1" },
        ],
      }),
    });
    expect(traced.map((piece) => piece.what)).toStrictEqual([
      "the pull request is merged",
      "the ticket has not moved for 10 days",
    ]);
  });

  it("falls back to the subject's own url when a piece of evidence carries none", () => {
    const traced = cycleEvidence({ proposal: proposal({ evidence: [{ fact: "no url on this one" }] }) });
    expect(traced[0]!.source).toBe("https://linear.app/w/issue/AAA-1");
  });
});

describe("cycleReadings", () => {
  it("reads drift from the proposal class, which is the signal only this leg can supply", () => {
    expect(cycleReadings({ proposal: proposal() }).drift).toBe(DRIFT_BY_ACTION["close-with-comment"]);
    expect(cycleReadings({ proposal: proposal({ action: "trace" }) }).drift).toBe(DRIFT_BY_ACTION.trace);
    expect(cycleReadings({ proposal: proposal({ action: "project-update" }) }).drift).toBe(
      DRIFT_BY_ACTION["project-update"],
    );
  });

  it("reads nobody as stopped on the owner, because that slice is the board leg's", () => {
    expect(cycleReadings({ proposal: proposal() }).stoppedOnOwner).toBe(0);
  });

  it("passes the day count through uncapped, leaving the magnitude to the ranker", () => {
    expect(cycleReadings({ proposal: proposal({ daysSinceMoved: 23 }) }).age).toBe(23);
  });

  it("puts a close at arm's length from done, because one word finishes it", () => {
    expect(cycleReadings({ proposal: proposal() }).distanceToDone).toBe(3);
  });

  it("reads an update with a drafted body as close to done, and one without as needing a decision", () => {
    const drafted = proposal({ action: "project-update", draft: "Project X\n\nNothing moved." });
    expect(cycleReadings({ proposal: drafted }).distanceToDone).toBe(3);
    expect(cycleReadings({ proposal: proposal({ action: "project-update" }) }).distanceToDone).toBe(1);
  });

  it("reads a trace as needing a decision first", () => {
    expect(cycleReadings({ proposal: proposal({ action: "trace" }) }).distanceToDone).toBe(1);
  });

  it("reads Linear's own priority labels and nothing else", () => {
    expect(cycleReadings({ proposal: proposal({ priority: "Urgent" }) }).explicitPriority).toBe(
      PRIORITY_READINGS["Urgent"],
    );
    expect(cycleReadings({ proposal: proposal({ priority: "High" }) }).explicitPriority).toBe(
      PRIORITY_READINGS["High"],
    );
    expect(cycleReadings({ proposal: proposal({ priority: "Medium" }) }).explicitPriority).toBe(0);
    expect(cycleReadings({ proposal: proposal({ priority: "No priority" }) }).explicitPriority).toBe(0);
    expect(cycleReadings({ proposal: proposal() }).explicitPriority).toBe(0);
  });
});

describe("cycleLeg", () => {
  it("turns a close proposal into a close, carrying the evidence that decided it", () => {
    const inputs = cycleLeg({ nowIso: NOW, proposals: [proposal()], verified: true });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.trace.verdict).toBe("propose-close");
    expect(inputs[0]!.trace.carried).toHaveLength(1);
  });

  it("holds a trace proposal out of the list for a live read rather than ranking it as work", () => {
    const inputs = cycleLeg({ nowIso: NOW, proposals: [proposal({ action: "trace" })], verified: true });
    expect(inputs[0]!.trace.verdict).toBe("re-read-live");
    expect(rankAll({ inputs }).ranked).toStrictEqual([]);
    expect(rankAll({ inputs }).dropped).toHaveLength(1);
  });

  it("ranks an overdue project update as ordinary outstanding work", () => {
    const inputs = cycleLeg({
      nowIso: NOW,
      proposals: [proposal({ action: "project-update", daysSinceMoved: 30, subject: "Project X" })],
      verified: true,
    });
    expect(inputs[0]!.trace.verdict).toBe("rank");
    expect(rankAll({ inputs }).ranked).toHaveLength(1);
  });

  it("treats every row as in-flight work, which is the tiebreak the north star sets", () => {
    expect(cycleLeg({ nowIso: NOW, proposals: [proposal()], verified: true })[0]!.finishesInFlight).toBe(true);
  });

  it("reports the whole leg unverified when the pass did not re-read its pull requests live", () => {
    expect(cycleLeg({ nowIso: NOW, proposals: [proposal()], verified: false })[0]!.unverified).toBe(true);
    expect(cycleLeg({ nowIso: NOW, proposals: [proposal()], verified: true })[0]!.unverified).toBe(false);
  });

  it("skips a proposal it cannot date and keeps the rest", () => {
    const inputs = cycleLeg({
      nowIso: NOW,
      proposals: [proposal({ dated: false }), proposal({ subject: "AAA-2" })],
      verified: true,
    });
    expect(inputs.map((input) => input.item.nativeId)).toStrictEqual(["AAA-2"]);
  });

  it("says the owner's move on every row, because the pass is scoped to the owner before it proposes anything", () => {
    expect(cycleLeg({ nowIso: NOW, proposals: [proposal()], verified: true })[0]!.ruleZero.verdict).toBe("show");
  });

  it("scores a close below a run that is literally stopped on the owner", () => {
    const close = cycleLeg({ nowIso: NOW, proposals: [proposal()], verified: true });
    const ranked = rankAll({ inputs: close }).ranked;
    // stoppedOnOwner is the board leg's 5 and this leg's 0, so the whole cycle slice sits under it by design.
    expect(ranked[0]!.contributions.stoppedOnOwner).toBe(0);
    expect(ranked[0]!.score).toBeLessThan(13);
  });
});

describe("cycleBackground", () => {
  it("says it is a ticket of the owner's, names it, and gives how long it has sat", () => {
    expect(cycleBackground({ proposal: proposal({ title: "Fix the upload" }) })).toBe(
      'A Linear ticket of yours: AAA-1, "Fix the upload". It has been sitting in your cycle for 10 day(s) without moving.',
    );
  });

  it("falls back to the key alone when the proposal carries no title", () => {
    expect(cycleBackground({ proposal: proposal() })).toContain("A Linear ticket of yours: AAA-1.");
  });

  it("describes a project update as a project rather than a ticket, because the action differs", () => {
    const update = proposal({ action: "project-update", subject: "Vulnerability management" });
    expect(cycleBackground({ proposal: update })).toBe(
      "A Linear project you lead: Vulnerability management. Its status update is what tells everyone else where it stands.",
    );
  });
});
