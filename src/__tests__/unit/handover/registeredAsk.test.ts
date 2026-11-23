/**
 * A registered ask carrying its whole shape, with no run behind it, is the OWNER'S — on the board, on the published
 * row the Queue draws, and never in the starving list a fill reads. The measured failure: four such rows sat in
 * `RUN NOW` for up to eight days while every chair pass told the owner they were on the Queue.
 */
import { describe, expect, it } from "vitest";

import {
  boardJsonDocument,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../cli/commands/handover/listJson.js";
import { publishedWaitOf } from "../../../cli/commands/handover/listJsonWait.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { registeredAskOf } from "../../../handover/registeredAsk.js";
import { EMPTY_TAG_FILTER } from "../../../handover/tagFilter.js";

const ASKED = "2026-09-24T12:52:00.000Z";
const QUESTION = "Which effort should a lookup use by default?";

/** A registered ask exactly as `handover register` writes one with its whole shape. */
function shapedAsk(over: Partial<HandoverDoc> = {}): HandoverDoc {
  return {
    anchor: "talk:a0000020",
    artifact: undefined,
    askedIso: ASKED,
    baseBranch: undefined,
    blastRadius: "the console voice's default",
    blockedBy: [],
    branch: undefined,
    doneWhen: [],
    evidence: [],
    hisWords: { kind: "absent" },
    hisWordsSteers: [],
    kind: "ask",
    lean: "medium",
    examples: [],
    exampleGap: undefined,
    notDoneReason: undefined,
    observedBy: undefined,
    registeredBy: undefined,
    registeredRun: undefined,
    options: [
      { letter: "A", option: "medium", tradeoff: "median 9.7s" },
      { letter: "B", option: "keep high", tradeoff: "median 17.9s" },
    ],
    origin: undefined,
    outputs: [],
    path: "/h/voice-effort.md",
    pausedOn: undefined,
    pausedSince: undefined,
    priority: "p1",
    probeWaiver: undefined,
    problem: "a lookup at high has median 17.9s",
    problems: [],
    repo: "/w/repo",
    risk: "a shallower answer",
    role: undefined,
    ruling: undefined,
    rulingAnchor: undefined,
    settlement: undefined,
    settlementReason: undefined,
    settlementWitness: undefined,
    slug: "voice-effort",
    status: "ready",
    statusSummary: undefined,
    stillReal: "DEFAULT_TALK_SETTINGS effort is high",
    stillRealIso: "2026-09-24T14:12:19.813Z",
    summary: QUESTION,
    supervisorState: undefined,
    ...over,
  };
}

/** What `composeBoardModels` reads per slug. */
interface Journal {
  readonly events: readonly RunEvent[];
  readonly unreadableLines: readonly number[];
}

function modelOf({
  doc,
  events,
  others = [],
}: {
  doc: HandoverDoc;
  events?: readonly RunEvent[];
  others?: readonly HandoverDoc[];
}): BoardModel {
  const journals = new Map<string, Journal>();
  if (events !== undefined) {
    journals.set(doc.slug, { events, unreadableLines: [] });
  }
  const docs = [doc, ...others];
  const models = composeBoardModels({ journals, probeStates: new Map(), resolutionDocs: docs, roots: [doc] });
  return models.find((model) => model.doc.slug === doc.slug)!;
}

/** A ruling `handover rule` journals, decided at `decidedIso`. */
function ruling({ decidedIso }: { decidedIso: string }): RunEvent {
  return { anchor: "transcript:abc#def", atIso: decidedIso, decidedIso, kind: "ruling", ruling: "medium" };
}

describe("registeredAskOf", () => {
  it("answers the summary and the asked instant for a whole-shaped ask no run has opened", () => {
    const model = modelOf({ doc: shapedAsk() });

    expect(registeredAskOf({ derived: model.derived, doc: model.doc, run: model.run })).toEqual({
      askedIso: ASKED,
      question: QUESTION,
    });
  });

  it("is absent on an ask with no shape — a free-text ask is not a decision drawn as it stands", () => {
    const model = modelOf({ doc: shapedAsk({ lean: undefined, options: [], problem: undefined }) });

    expect(registeredAskOf({ derived: model.derived, doc: model.doc, run: model.run })).toBeUndefined();
  });

  it("is absent on a doc row carrying no ask at all", () => {
    const model = modelOf({ doc: shapedAsk({ kind: "doc" }) });

    expect(registeredAskOf({ derived: model.derived, doc: model.doc, run: model.run })).toBeUndefined();
  });

  it("is absent once a run has opened — the run owns the question", () => {
    const model = modelOf({
      doc: shapedAsk(),
      events: [{ atIso: "2026-09-25T00:00:00.000Z", branch: "b", docHash: "h", kind: "started" }],
    });

    expect(model.run.kind).toBe("active");
    expect(registeredAskOf({ derived: model.derived, doc: model.doc, run: model.run })).toBeUndefined();
  });

  it("is absent on a settled ask", () => {
    const model = modelOf({ doc: shapedAsk({ settlement: "answered", settlementWitness: "https://x/p1" }) });

    expect(registeredAskOf({ derived: model.derived, doc: model.doc, run: model.run })).toBeUndefined();
  });

  it("is absent on a paused ask", () => {
    const model = modelOf({ doc: shapedAsk({ pausedOn: "a reviewer", status: "paused" }) });

    expect(registeredAskOf({ derived: model.derived, doc: model.doc, run: model.run })).toBeUndefined();
  });

  it("is absent when askedIso does not parse, since the Queue ages the row from it", () => {
    const model = modelOf({ doc: shapedAsk({ askedIso: "last tuesday" }) });

    expect(registeredAskOf({ derived: model.derived, doc: model.doc, run: model.run })).toBeUndefined();
  });

  it("is absent once the owner has ruled at or after the ask", () => {
    const model = modelOf({ doc: shapedAsk(), events: [ruling({ decidedIso: "2026-09-25T00:00:00.000Z" })] });

    expect(model.run.kind).toBe("never-started");
    expect(registeredAskOf({ derived: model.derived, doc: model.doc, run: model.run })).toBeUndefined();
  });

  it("stays the owner's when the only ruling was decided BEFORE they were asked", () => {
    const model = modelOf({ doc: shapedAsk(), events: [ruling({ decidedIso: "2026-09-20T00:00:00.000Z" })] });

    expect(registeredAskOf({ derived: model.derived, doc: model.doc, run: model.run })!.question).toBe(QUESTION);
  });
});

describe("the board places a registered, whole-shaped ask", () => {
  it("in WAITING ON OWNER, saying what it asks", () => {
    const model = modelOf({ doc: shapedAsk() });

    expect(model.section).toBe("WAITING ON OWNER");
    expect(model.reason).toBe(`waiting on the owner: ${QUESTION}`);
  });

  it("in RUN NOW once the owner has ruled, where a seat executes the ruling", () => {
    const model = modelOf({ doc: shapedAsk(), events: [ruling({ decidedIso: "2026-09-25T00:00:00.000Z" })] });

    expect(model.section).toBe("RUN NOW");
  });

  it("in NOT YET while a prerequisite is unfinished — a dependency still holds it", () => {
    const prerequisite = shapedAsk({ kind: "doc", path: "/h/first.md", slug: "first", summary: "first" });
    const model = modelOf({ doc: shapedAsk({ blockedBy: ["first"] }), others: [prerequisite] });

    expect(model.section).toBe("NOT YET");
  });

  it("an unshaped ask stays in RUN NOW, as before", () => {
    const model = modelOf({ doc: shapedAsk({ lean: undefined, options: [], problem: undefined }) });

    expect(model.section).toBe("RUN NOW");
  });
});

describe("publishedWaitOf", () => {
  it("reads the registered ask off a row the board parked on the owner with no run", () => {
    expect(publishedWaitOf({ model: modelOf({ doc: shapedAsk() }) })).toEqual({
      question: QUESTION,
      questionAskedIso: ASKED,
      wait: { askedIso: ASKED, kind: "owner" },
    });
  });

  it("reads the run's own question over the registered one once a run has asked", () => {
    const model = modelOf({
      doc: shapedAsk(),
      events: [
        { atIso: "2026-09-25T00:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
        { atIso: "2026-09-25T01:00:00.000Z", kind: "question", question: "medium or high?" },
      ],
    });

    expect(publishedWaitOf({ model })).toEqual({
      question: "medium or high?",
      questionAskedIso: "2026-09-25T01:00:00.000Z",
      wait: { askedIso: "2026-09-25T01:00:00.000Z", kind: "owner" },
    });
  });
});

describe("the published row the Queue draws", () => {
  function rowFor({ doc, events }: { doc: HandoverDoc; events?: readonly RunEvent[] }) {
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: [modelOf({ doc, ...(events === undefined ? {} : { events }) })],
      observedAtIso: "2026-09-30T00:00:00.000Z",
      references: NO_BOARD_REFERENCES,
      scanStartedIso: "2026-09-30T00:00:00.000Z",
      unreadable: [],
      unresolved: 0,
    });
    return document.rows.find((row) => row.slug === doc.slug)!;
  }

  it("carries the question, its asked instant and the owner's ownerWait, with the run still never-started", () => {
    const row = rowFor({ doc: shapedAsk() });

    expect([row.question, row.questionAskedIso, row.ownerWait, row.run, row.section]).toEqual([
      QUESTION,
      ASKED,
      "owner",
      "never-started",
      "WAITING ON OWNER",
    ]);
  });

  it("publishes no question on the same ask once the owner has ruled", () => {
    const row = rowFor({ doc: shapedAsk(), events: [ruling({ decidedIso: "2026-09-25T00:00:00.000Z" })] });

    expect([row.question, row.questionAskedIso, row.ownerWait]).toEqual([undefined, undefined, "not-waiting"]);
  });

  it("publishes no question while a dependency holds it in NOT YET", () => {
    const prerequisite = shapedAsk({ kind: "doc", path: "/h/first.md", slug: "first", summary: "first" });
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: [modelOf({ doc: shapedAsk({ blockedBy: ["first"] }), others: [prerequisite] })],
      observedAtIso: "2026-09-30T00:00:00.000Z",
      references: NO_BOARD_REFERENCES,
      scanStartedIso: "2026-09-30T00:00:00.000Z",
      unreadable: [],
      unresolved: 0,
    });
    const row = document.rows.find((candidate) => candidate.slug === "voice-effort")!;

    expect([row.section, row.question, row.ownerWait]).toEqual(["NOT YET", undefined, "not-waiting"]);
  });
});
