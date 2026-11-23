import { describe, expect, it } from "vitest";
import type { RunEvent } from "../../../handover/ledger.js";
import type { BoardEntry } from "../../../sessionStart/boardLeg.js";
import {
  AGE_DAYS_CAP,
  boardBackground,
  boardEvidence,
  boardItem,
  boardLeg,
  boardReadings,
  boardRuleZero,
  claimsCompletion,
  holderIsGone,
  openingSentences,
  openQuestion,
} from "../../../sessionStart/boardLeg.js";
import { rankAll } from "../../../sessionStart/rank.js";

const NOW = "2026-08-30T00:00:00.000Z";

const started = ({ atIso }: { atIso: string }): RunEvent => ({
  atIso,
  branch: "a-branch",
  docHash: "0123456789abcdef",
  kind: "started",
});

const asked = ({ atIso, question }: { atIso: string; question: string }): RunEvent => ({
  atIso,
  kind: "question",
  question,
});

/** A run stopped on the owner for one day, with prose that claims nothing. */
const waiting: BoardEntry = {
  events: [
    started({ atIso: "2026-08-28T00:00:00.000Z" }),
    asked({ atIso: "2026-08-29T00:00:00.000Z", question: "pick reading A or reading B for the PR count" }),
  ],
  holder: { kind: "live" },
  repo: "/repos/dev/personal/slopweaver",
  slug: "acme-waiting-run",
  summary: "Decide which of the two readings the count should use.",
};

/**
 * The same run, held by a session that no longer exists.
 *
 * Finished rows once sat on the owner's list because of this: a question frozen in
 * `WAITING ON OWNER` by a session that could no longer write an `answered` back to its own journal.
 */
const holderGone: BoardEntry = { ...waiting, holder: { kind: "dead" }, slug: "a-run-whose-session-died" };

/** The same run again, held by a session this machine cannot classify either way. */
const holderUnknown: BoardEntry = {
  ...waiting,
  holder: { kind: "unknown", why: "Codex exposes no live-thread registry to this CLI" },
  slug: "a-run-held-by-codex",
};

describe("openQuestion", () => {
  it("finds the current cycle's open question", () => {
    const found = openQuestion({ events: waiting.events })!;
    expect(found.question).toBe("pick reading A or reading B for the PR count");
    expect(found.askedAtIso).toBe("2026-08-29T00:00:00.000Z");
  });

  it("reads a correction's text, keeping when the question was first asked", () => {
    const events: readonly RunEvent[] = [
      ...waiting.events,
      {
        atIso: "2026-08-29T03:00:00.000Z",
        kind: "question-corrected",
        question: "reading A, B or C?",
        why: "missed C",
      },
    ];
    const found = openQuestion({ events })!;

    expect(found.question).toBe("reading A, B or C?");
    expect(found.askedAtIso).toBe("2026-08-29T00:00:00.000Z");
  });

  it("reports nothing when an answer followed the question", () => {
    const events: readonly RunEvent[] = [
      ...waiting.events,
      { answer: "reading B", atIso: "2026-08-29T06:00:00.000Z", kind: "answered" },
    ];
    expect(openQuestion({ events })).toBe(undefined);
  });

  it("reports nothing when the run finished after asking", () => {
    const events: readonly RunEvent[] = [
      ...waiting.events,
      { atIso: "2026-08-29T06:00:00.000Z", kind: "finished", residue: [] },
    ];
    expect(openQuestion({ events })).toBe(undefined);
  });

  it("still finds the question when its session died and a new cycle opened, as the run state does", () => {
    const events: readonly RunEvent[] = [
      ...waiting.events,
      {
        atIso: "2026-08-30T00:00:00.000Z",
        cycleEvents: 2,
        deadSessionId: "dead-session",
        kind: "orphaned",
        lastEventIso: "2026-08-29T00:00:00.000Z",
      },
      { atIso: "2026-08-31T00:00:00.000Z", branch: "work", docHash: "abc", kind: "started" },
    ];
    const found = openQuestion({ events })!;
    expect(found.question).toBe("pick reading A or reading B for the PR count");
    expect(found.askedAtIso).toBe("2026-08-29T00:00:00.000Z");
  });

  it("still finds the question when a peer started over the waiting cycle with no ending on it", () => {
    const events: readonly RunEvent[] = [
      ...waiting.events,
      { atIso: "2026-08-31T00:00:00.000Z", branch: "work", docHash: "abc", kind: "started" },
    ];
    const found = openQuestion({ events })!;
    expect(found.question).toBe("pick reading A or reading B for the PR count");
    expect(found.askedAtIso).toBe("2026-08-29T00:00:00.000Z");
  });

  it("reports nothing when the run was abandoned after asking", () => {
    const events: readonly RunEvent[] = [
      ...waiting.events,
      { atIso: "2026-08-29T06:00:00.000Z", kind: "abandoned", why: "superseded" },
    ];
    expect(openQuestion({ events })).toBe(undefined);
  });

  it("ignores a question answered in an earlier cycle", () => {
    const events: readonly RunEvent[] = [
      started({ atIso: "2026-08-20T00:00:00.000Z" }),
      asked({ atIso: "2026-08-21T00:00:00.000Z", question: "an old question" }),
      { answer: "settled", atIso: "2026-08-22T00:00:00.000Z", kind: "answered" },
      started({ atIso: "2026-08-28T00:00:00.000Z" }),
    ];
    expect(openQuestion({ events })).toBe(undefined);
  });

  it("takes the latest question when a cycle recorded two", () => {
    const events: readonly RunEvent[] = [
      ...waiting.events,
      asked({ atIso: "2026-08-29T12:00:00.000Z", question: "and which repo should it name" }),
    ];
    expect(openQuestion({ events })!.question).toBe("and which repo should it name");
  });

  it("reports nothing for a journal that never started", () => {
    expect(openQuestion({ events: [] })).toBe(undefined);
  });
});

describe("claimsCompletion", () => {
  it("catches a summary claiming the work already landed", () => {
    expect(claimsCompletion({ summary: "This LANDED as fd986256 and needs nothing further." })).toBe(true);
  });

  it("treats a doc with no summary as claiming nothing", () => {
    expect(claimsCompletion({ summary: undefined })).toBe(false);
  });

  it("leaves an ordinary summary alone", () => {
    expect(claimsCompletion({ summary: "Decide which of the two readings the count should use." })).toBe(false);
  });
});

describe("boardEvidence", () => {
  it("grades the journal fact as something the provider owns", () => {
    const question = openQuestion({ events: waiting.events })!;
    const evidence = boardEvidence({ entry: waiting, question });
    expect(evidence.length).toBe(1);
    expect(evidence[0]!.grade).toBe("provider-fact");
    expect(evidence[0]!.showsResolved).toBe(false);
    expect(evidence[0]!.source).toBe("slopweaver handover resume acme-waiting-run");
  });

  it("withholds the journal fact once the prose claims completion, leaving only the unconfirmed claim", () => {
    const entry: BoardEntry = { ...waiting, summary: "This work has landed; nothing remains." };
    const question = openQuestion({ events: entry.events })!;
    const evidence = boardEvidence({ entry, question });
    expect(evidence.length).toBe(1);
    expect(evidence[0]!.grade).toBe("machine-account");
    expect(evidence[0]!.showsResolved).toBe(true);
  });

  it("emits no provider fact alongside a completion claim, which would silently outrank it", () => {
    const entry: BoardEntry = { ...waiting, summary: "This work has landed; nothing remains." };
    const question = openQuestion({ events: entry.events })!;
    expect(boardEvidence({ entry, question }).some((piece) => piece.grade === "provider-fact")).toBe(false);
  });
});

describe("boardReadings", () => {
  it("puts the two definitional signals at their caps and leaves drift to another leg", () => {
    const question = openQuestion({ events: waiting.events })!;
    const readings = boardReadings({ holderGone: false, nowIso: NOW, question });
    expect(readings.stoppedOnOwner).toBe(5);
    expect(readings.directness).toBe(3);
    expect(readings.distanceToDone).toBe(3);
    expect(readings.drift).toBe(0);
    expect(readings.explicitPriority).toBe(0);
  });

  it("reads age as whole days of silence", () => {
    const question = openQuestion({ events: waiting.events })!;
    expect(boardReadings({ holderGone: false, nowIso: NOW, question }).age).toBe(1);
  });

  it("caps age so an ancient question cannot outweigh the definitional signals", () => {
    const question = { askedAtIso: "2026-01-01T00:00:00.000Z", question: "an ancient one" };
    expect(boardReadings({ holderGone: false, nowIso: NOW, question }).age).toBe(AGE_DAYS_CAP);
  });

  it("reads age as zero for a question recorded in the future", () => {
    const question = { askedAtIso: "2026-09-30T00:00:00.000Z", question: "a clock running ahead" };
    expect(boardReadings({ holderGone: false, nowIso: NOW, question }).age).toBe(0);
  });

  it("reads age as zero when the instant does not parse", () => {
    const question = { askedAtIso: "not-a-date", question: "an unreadable instant" };
    expect(boardReadings({ holderGone: false, nowIso: NOW, question }).age).toBe(0);
  });
});

describe("holderIsGone", () => {
  it("is true only for a holder measured dead", () => {
    expect(holderIsGone({ entry: holderGone })).toBe(true);
  });

  it("is false for a live holder", () => {
    expect(holderIsGone({ entry: waiting })).toBe(false);
  });

  it("is false for an UNKNOWN holder — an unclassifiable session is not a dead one", () => {
    expect(holderIsGone({ entry: holderUnknown })).toBe(false);
  });

  it("is false when the journal names no writer at all", () => {
    expect(holderIsGone({ entry: { ...waiting, holder: undefined } })).toBe(false);
  });
});

describe("a run whose holding session is gone", () => {
  it("does not read as waiting on the owner — nobody is, and the row says so", () => {
    const item = boardItem({ entry: holderGone })!;
    expect(item.who).toBe("nobody — its session is gone");
    expect(item.state).toBe("its session is gone — resume it or abandon it");
  });

  it("scores zero on stoppedOnOwner, which is the signal that put finished rows above real work", () => {
    const question = openQuestion({ events: holderGone.events })!;
    expect(boardReadings({ holderGone: true, nowIso: NOW, question }).stoppedOnOwner).toBe(0);
  });

  it("says in its evidence that nothing is going to answer the question", () => {
    const question = openQuestion({ events: holderGone.events })!;
    const evidence = boardEvidence({ entry: holderGone, question });
    expect(evidence.length).toBe(1);
    expect(evidence[0]!.what).toBe(
      "its question at 2026-08-29T00:00:00.000Z was recorded by a session that no longer exists, so nothing is going to answer it or write back to it",
    );
  });

  it("still reaches the list — only the owner can rule on resuming or abandoning it", () => {
    const ranked = rankAll({ inputs: boardLeg({ entries: [holderGone], nowIso: NOW }) }).ranked;
    expect(ranked.length).toBe(1);
    expect(ranked[0]!.contributions.stoppedOnOwner).toBe(0);
  });

  it("ranks BELOW an identical run whose session is still alive, which is the whole demotion", () => {
    const ranked = rankAll({ inputs: boardLeg({ entries: [holderGone, waiting], nowIso: NOW }) }).ranked;
    expect(ranked.map((row) => row.item.nativeId)).toStrictEqual(["acme-waiting-run", "a-run-whose-session-died"]);
    expect(ranked[0]!.score - ranked[1]!.score).toBe(5);
  });

  it("leaves an UNKNOWN holder reading exactly as it did before — the check is falsifiable", () => {
    const item = boardItem({ entry: holderUnknown })!;
    expect(item.who).toBe("the session holding it");
    expect(item.state).toBe("waiting on owner");
    const ranked = rankAll({ inputs: boardLeg({ entries: [holderUnknown], nowIso: NOW }) }).ranked;
    expect(ranked[0]!.contributions.stoppedOnOwner).toBe(5);
  });
});

describe("boardItem", () => {
  it("fills all four mandatory fields from the journal", () => {
    const item = boardItem({ entry: waiting })!;
    expect(item.source).toBe("handover");
    expect(item.nativeId).toBe("acme-waiting-run");
    expect(item.who).toBe("the session holding it");
    expect(item.where).toBe("slopweaver handover resume acme-waiting-run");
    expect(item.whenIso).toBe("2026-08-29T00:00:00.000Z");
    expect(item.doneWhen).toBe("pick reading A or reading B for the PR count");
    expect(item.state).toBe("waiting on owner");
  });

  it("names the session's ROLE, so a long slug cannot make `who` grow — the briefing cap's own defect", () => {
    // MEASURED on a real `slopweaver session-start --json` run of 78 ranked rows: this slug
    // made `the <slug> session` 122 characters, and `briefing render` refused the whole page at
    // `yourList.rows.N.who` against its 120-character cap. Both labels below are the same length whatever
    // the slug runs to, and the slug itself is untouched in the two fields that identify the run.
    const slug =
      "acme-a-very-long-board-row-slug-that-names-every-step-of-the-plan-and-every-scope-it-asks-for-before-it-reruns";
    const live = boardItem({ entry: { ...waiting, slug } })!;
    const dead = boardItem({ entry: { ...waiting, holder: { kind: "dead" }, slug } })!;

    expect(slug.length).toBe(110);
    expect(live.who).toBe("the session holding it");
    expect(dead.who).toBe("nobody — its session is gone");
    expect(live.where).toBe(`slopweaver handover resume ${slug}`);
    expect(live.nativeId).toBe(slug);
  });

  it("never puts a home path where the hygiene gate would flag one", () => {
    expect(boardItem({ entry: waiting })!.where).not.toMatch(/\/(?:Users|home)\//);
  });

  it("produces nothing for a run with no open question", () => {
    const entry: BoardEntry = { ...waiting, events: [started({ atIso: "2026-08-28T00:00:00.000Z" })] };
    expect(boardItem({ entry })).toBe(undefined);
  });
});

describe("boardRuleZero", () => {
  it("shows every row, because the slice is the owner's move by construction", () => {
    const question = openQuestion({ events: waiting.events })!;
    const decision = boardRuleZero({ nowIso: NOW, question });
    expect(decision.verdict).toBe("show");
    expect(decision.reason).toBe("waiting on you");
    expect(decision.silentHours).toBe(24);
  });
});

describe("boardLeg", () => {
  it("emits one rankable input per waiting run", () => {
    const inputs = boardLeg({ entries: [waiting], nowIso: NOW });
    expect(inputs.length).toBe(1);
    expect(inputs[0]!.trace.verdict).toBe("rank");
    expect(inputs[0]!.finishesInFlight).toBe(true);
    expect(inputs[0]!.unverified).toBe(false);
  });

  it("holds a doc whose own prose claims completion for a live read", () => {
    const entry: BoardEntry = { ...waiting, summary: "This is already done — merged as abc1234." };
    const inputs = boardLeg({ entries: [entry], nowIso: NOW });
    expect(inputs[0]!.trace.verdict).toBe("re-read-live");
    expect(rankAll({ inputs }).ranked.length).toBe(0);
    expect(rankAll({ inputs }).dropped[0]!.reason).toBe(
      "something says this is already done, but nothing the provider owns confirms it — read it live",
    );
  });

  it("skips a run that is not waiting on the owner", () => {
    const entry: BoardEntry = { ...waiting, events: [started({ atIso: "2026-08-28T00:00:00.000Z" })] };
    expect(boardLeg({ entries: [entry], nowIso: NOW }).length).toBe(0);
  });

  it("scores a waiting row on the two definitional signals plus its age", () => {
    const ranking = rankAll({ inputs: boardLeg({ entries: [waiting], nowIso: NOW }) });
    expect(ranking.ranked.length).toBe(1);
    expect(ranking.ranked[0]!.score).toBe(12);
    expect(ranking.ranked[0]!.why).toBe("somebody is stopped waiting on you");
  });

  it("orders the longest-waiting question first", () => {
    const older: BoardEntry = {
      ...waiting,
      events: [
        started({ atIso: "2026-08-20T00:00:00.000Z" }),
        asked({ atIso: "2026-08-21T00:00:00.000Z", question: "the older question" }),
      ],
      slug: "an-older-run",
    };
    const ranking = rankAll({ inputs: boardLeg({ entries: [waiting, older], nowIso: NOW }) });
    expect(ranking.ranked.map((row) => row.item.nativeId)).toStrictEqual(["an-older-run", "acme-waiting-run"]);
  });

  it("emits nothing for an empty board", () => {
    expect(boardLeg({ entries: [], nowIso: NOW })).toStrictEqual([]);
  });
});

describe("boardBackground", () => {
  it("says what the run is for, using the doc's own summary", () => {
    expect(boardBackground({ entry: waiting })).toBe(
      "An orchestration run you started, working under the slug acme-waiting-run. It works in /repos/dev/personal/slopweaver. What it is for: Decide which of the two readings the count should use.",
    );
  });

  it("leaves the repository clause out when the doc names none", () => {
    const { repo, ...noRepo } = waiting;
    expect(boardBackground({ entry: { ...noRepo, repo: undefined } })).toBe(
      "An orchestration run you started, working under the slug acme-waiting-run. What it is for: Decide which of the two readings the count should use.",
    );
  });

  // The flat reader decodes `\u0085`, which JavaScript's `\s` does not match, into a summary kept exact.
  it("holds a summary carrying a NEXT LINE to one line", () => {
    const summary = `Decide which reading${String.fromCharCode(0x85)}FORGED ROW`;
    expect(boardBackground({ entry: { ...waiting, repo: undefined, summary } })).toBe(
      "An orchestration run you started, working under the slug acme-waiting-run. What it is for: Decide which reading FORGED ROW",
    );
  });

  it("is undefined when the doc describes itself nowhere, so the row drops rather than reading blank", () => {
    expect(boardBackground({ entry: { ...waiting, summary: undefined } })).toBeUndefined();
  });
});

describe("openingSentences", () => {
  it("keeps a summary that is already short", () => {
    expect(openingSentences({ prose: "One sentence only." })).toBe("One sentence only.");
  });

  it("cuts a filed brief to two sentences, because the whole thing is a wall", () => {
    expect(openingSentences({ prose: "First one. Second one. Third one. Fourth one." })).toBe("First one. Second one.");
  });

  it("returns prose with no sentence break unchanged rather than emptying it", () => {
    expect(openingSentences({ prose: "no terminator here" })).toBe("no terminator here");
  });
});
