import { describe, expect, it } from "vitest";

import { composeBoardModels } from "../../../handover/boardState.js";
import { type BoardModel } from "../../../handover/boardTypes.js";
import type { DocProbeState, HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { classifyBoard, classifyBoardRow, verdictCensus } from "../../../sweep/classify.js";
import type { SupersessionEdge } from "../../../sweep/supersession.js";

function doc({
  slug,
  status = "ready",
  blockedBy = [],
  doneWhen = [],
  branch,
  pausedOn,
  pausedSince,
}: {
  slug: string;
  status?: HandoverDoc["status"];
  blockedBy?: readonly string[];
  doneWhen?: HandoverDoc["doneWhen"];
  branch?: string;
  pausedOn?: string;
  pausedSince?: string;
}): HandoverDoc {
  return {
    anchor: undefined,
    artifact: undefined,
    askedIso: undefined,
    baseBranch: undefined,
    blockedBy,
    branch,
    doneWhen,
    evidence: [],
    kind: "doc",
    notDoneReason: undefined,
    observedBy: undefined,
    registeredBy: undefined,
    registeredRun: undefined,
    origin: undefined,
    outputs: [],
    path: `/h/${slug}.md`,
    pausedOn,
    pausedSince,
    risk: undefined,
    blastRadius: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    priority: undefined,
    probeWaiver: undefined,
    lean: undefined,
    examples: [],
    exampleGap: undefined,
    options: [],
    problem: undefined,
    problems: [],
    repo: "/w/repo",
    role: undefined,
    ruling: undefined,
    rulingAnchor: undefined,
    hisWords: { kind: "absent" },
    hisWordsSteers: [],
    settlement: undefined,
    settlementReason: undefined,
    settlementWitness: undefined,
    slug,
    status,
    statusSummary: undefined,
    summary: `what ${slug} does`,
    supervisorState: undefined,
  };
}

const PRESENT_PROBE = { file: "src/a.ts", kind: "present", symbol: "thing" } as const;

/*
 * The measured generation pair, its epochs and instants kept and its slugs minted under the security
 * family's current `slugStem` — the supersession reader matches on that stem, so a fixture on the old one would
 * test nothing. These are the measured SHAPE, not the recorded rows' names.
 */
const OLD_GENERATION = "vulnerability-fix-topup-acme-acme-admin-1789633808900";
const NEW_GENERATION = "vulnerability-fix-topup-acme-acme-admin-1792411589626";
/** The measured row's own pause, set before the newer generation fired, on the current stem. */
const RECIPE_PAUSE = "the vulnerability-fix-topup-acme-admin recipe's next firing";
const RECIPE_PAUSED_SINCE = "2026-10-18T20:44:52.015Z";

/** A board outside the default home, with a space in its path, so a printed command must name and quote it. */
const BOARD = { handoverDir: "/tmp/replay home/handovers", home: "/tmp/replay home" } as const;
const THIS_BOARD = "`--home '/tmp/replay home' --dir '/tmp/replay home/handovers'`";
const SETTLE_WHEN = `its batch may carry none of this row's packages, so read where they stand: if one is still owed, keep this row; if none is, settle it once nobody holds it, with whichever ending and witness the facts support (\`slopweaver handover settle --help\`; a decline is the owner's alone), naming this board: ${THIS_BOARD}`;

const GENERATION_EDGE: SupersessionEdge = {
  kind: "generation",
  newerSlug: NEW_GENERATION,
  recipe: "vulnerability-fix-topup-acme-admin",
  registeredIso: "2026-10-19T12:06:29.630Z",
};

function passingState(): DocProbeState {
  return {
    commitsAhead: 0,
    computed: "landed",
    results: [{ note: "found in src/a.ts", outcome: "pass", probe: PRESENT_PROBE }],
  };
}

function failingState(): DocProbeState {
  return {
    commitsAhead: 0,
    computed: "partial",
    results: [{ note: "not found in src/a.ts", outcome: "fail", probe: PRESENT_PROBE }],
  };
}

/** One slug's run journal, in the shape `composeBoardModels` reads it. */
type RunJournals = ReadonlyMap<
  string,
  { readonly events: readonly RunEvent[]; readonly unreadableLines: readonly number[] }
>;

function journalOf({ slug, events }: { slug: string; events: readonly RunEvent[] }): RunJournals {
  return new Map([[slug, { events, unreadableLines: [] }]]);
}

function modelsFor({
  docs,
  probeStates = new Map<string, DocProbeState>(),
  journals = new Map(),
}: {
  docs: readonly HandoverDoc[];
  probeStates?: ReadonlyMap<string, DocProbeState>;
  journals?: RunJournals;
}): readonly BoardModel[] {
  return composeBoardModels({ journals, probeStates, resolutionDocs: docs, roots: docs });
}

function modelFor({
  docs,
  probeStates = new Map<string, DocProbeState>(),
  journals = new Map(),
  slug,
}: {
  docs: readonly HandoverDoc[];
  probeStates?: ReadonlyMap<string, DocProbeState>;
  journals?: RunJournals;
  slug: string;
}): BoardModel {
  return modelsFor({ docs, journals, probeStates }).find((model) => model.doc.slug === slug)!;
}

describe("classifyBoardRow", () => {
  it("keeps a row that is already terminal, naming the section rather than proposing an act", () => {
    const candidate = classifyBoardRow({
      board: BOARD,
      model: modelFor({ docs: [doc({ slug: "shipped-row", status: "done" })], slug: "shipped-row" }),
      supersession: undefined,
    });
    expect(candidate.verdict).toBe("KEEP");
    expect(candidate.act).toBe("none");
    expect(candidate.witness).toBe("already terminal — section DONE");
  });

  it("reports a contradiction and does NOT offer an act, because no verb makes a contradiction true", () => {
    const row = doc({ doneWhen: [PRESENT_PROBE], slug: "says-done", status: "done" });
    const candidate = classifyBoardRow({
      board: BOARD,
      model: modelFor({
        docs: [row],
        probeStates: new Map([[row.path, failingState()]]),
        slug: "says-done",
      }),
      supersession: undefined,
    });
    expect(candidate.verdict).toBe("CONTRADICTED");
    expect(candidate.act).toBe("none");
    expect(candidate.witness).toContain("1 probe(s) failing, 0 passing");
  });

  it("calls a row SHIPPED when every declared probe passes, and routes it to close", () => {
    const row = doc({ doneWhen: [PRESENT_PROBE], slug: "looks-shipped" });
    const candidate = classifyBoardRow({
      board: BOARD,
      model: modelFor({ docs: [row], probeStates: new Map([[row.path, passingState()]]), slug: "looks-shipped" }),
      supersession: undefined,
    });
    expect(candidate.verdict).toBe("SHIPPED");
    expect(candidate.act).toBe("close");
    expect(candidate.witness).toBe("all 1 declared probe(s) pass against the tree — the work is in");
  });

  // A closed run usually lands the row in `DONE`, which the terminal arm above keeps. The reachable case is a
  // row PARKED on somebody whose work shipped anyway: `pausedEvidence` outranks `shippedEvidence`, so the
  // section is still live and only the journal knows the work is in.
  it("calls a row parked on a person SHIPPED when its journal records a closed event, quoting the summary", () => {
    const row = doc({ pausedOn: "a colleague", slug: "parked-but-shipped", status: "paused" });
    const candidate = classifyBoardRow({
      board: BOARD,
      model: modelFor({
        docs: [row],
        journals: journalOf({
          events: [
            { atIso: "2026-09-17T00:00:00.000Z", branch: "a-branch", docHash: "abc123", kind: "started" },
            { atIso: "2026-09-18T01:02:03.000Z", kind: "closed", residue: [], summary: "the verb shipped in #888" },
          ],
          slug: "parked-but-shipped",
        }),
        slug: "parked-but-shipped",
      }),
      supersession: undefined,
    });
    expect(candidate.verdict).toBe("SHIPPED");
    expect(candidate.act).toBe("close");
    expect(candidate.witness).toBe(
      "journal records a closed event at 2026-09-18T01:02:03.000Z: the verb shipped in #888",
    );
  });

  it("calls a row ORPHANED when blockedBy reaches a terminal-unshipped prerequisite", () => {
    const dead = doc({ slug: "dead-leaf", status: "rejected" });
    const blocked = doc({ blockedBy: ["dead-leaf"], slug: "can-never-run" });
    const candidate = classifyBoardRow({
      board: BOARD,
      model: modelFor({ docs: [dead, blocked], slug: "can-never-run" }),
      supersession: undefined,
    });
    expect(candidate.verdict).toBe("ORPHANED");
    expect(candidate.act).toBe("settle");
    expect(candidate.witness).toContain("dead-leaf");
    expect(candidate.witness).toContain("it can never run");
  });

  it("calls a row SUPERSEDED only when the caller supplies the declaring slug", () => {
    const model = modelFor({ docs: [doc({ slug: "old-row" })], slug: "old-row" });
    expect(classifyBoardRow({ board: BOARD, model, supersession: undefined }).verdict).toBe("UNWITNESSED");
    const candidate = classifyBoardRow({
      board: BOARD,
      model,
      supersession: { kind: "declared", newerSlug: "new-row" },
    });
    expect(candidate.verdict).toBe("SUPERSEDED");
    expect(candidate.act).toBe("settle");
    expect(candidate.witness).toBe("new-row declares this slug superseded, is newer, and is itself still live");
  });

  it("reports a top-up generation with a later one OVERTAKEN, never SUPERSEDED, with no act and no ending", () => {
    const model = modelFor({ docs: [doc({ slug: OLD_GENERATION })], slug: OLD_GENERATION });
    expect(model.section).toBe("RUN NOW");
    const candidate = classifyBoardRow({ board: BOARD, model, supersession: GENERATION_EDGE });
    expect(candidate.verdict).toBe("OVERTAKEN");
    expect(candidate.act).toBe("none");
    expect(candidate.witness).toBe(
      `${NEW_GENERATION} matches this row's top-up slug and batch brief with a later slug epoch, 2026-10-19T12:06:29.630Z — ${SETTLE_WHEN}`,
    );
  });

  it("never lets a generation edge touch a row whose question waits on the owner", () => {
    const events: readonly RunEvent[] = [
      { atIso: "2026-10-01T10:00:00.000Z", branch: OLD_GENERATION, docHash: "h", kind: "started" },
      { atIso: "2026-10-01T11:00:00.000Z", kind: "question", question: "wait for the Clerk instance?" },
    ];
    const model = modelFor({
      docs: [doc({ slug: OLD_GENERATION })],
      journals: journalOf({ events, slug: OLD_GENERATION }),
      slug: OLD_GENERATION,
    });
    expect(model.section).toBe("WAITING ON OWNER");
    expect(classifyBoardRow({ board: BOARD, model, supersession: GENERATION_EDGE }).verdict).toBe("UNWITNESSED");
    expect(
      classifyBoardRow({ board: BOARD, model, supersession: { kind: "declared", newerSlug: "new-row" } }).verdict,
    ).toBe("SUPERSEDED");
  });

  it("never lets a generation edge touch a row with a seat in flight", () => {
    const events: readonly RunEvent[] = [
      { atIso: "2026-10-01T10:00:00.000Z", branch: OLD_GENERATION, docHash: "h", kind: "started" },
    ];
    const model = modelFor({
      docs: [doc({ slug: OLD_GENERATION })],
      journals: journalOf({ events, slug: OLD_GENERATION }),
      slug: OLD_GENERATION,
    });
    expect(model.section).toBe("IN FLIGHT");
    expect(classifyBoardRow({ board: BOARD, model, supersession: GENERATION_EDGE }).verdict).toBe("UNWITNESSED");
  });

  it("never lets a generation edge touch a finished row awaiting ship, whose pull requests may still be open", () => {
    const events: readonly RunEvent[] = [
      { atIso: "2026-10-01T10:00:00.000Z", branch: OLD_GENERATION, docHash: "h", kind: "started" },
      { atIso: "2026-10-01T12:00:00.000Z", kind: "finished", residue: [] },
    ];
    const model = modelFor({
      docs: [doc({ slug: OLD_GENERATION })],
      journals: journalOf({ events, slug: OLD_GENERATION }),
      slug: OLD_GENERATION,
    });
    expect(model.section).toBe("AWAITING SHIP");
    expect(classifyBoardRow({ board: BOARD, model, supersession: GENERATION_EDGE }).verdict).toBe("UNWITNESSED");
  });

  it("never lets a generation edge touch a draft row", () => {
    const model = modelFor({ docs: [doc({ slug: OLD_GENERATION, status: "draft" })], slug: OLD_GENERATION });
    expect(model.section).toBe("NOT YET");
    expect(classifyBoardRow({ board: BOARD, model, supersession: GENERATION_EDGE }).verdict).toBe("UNWITNESSED");
  });

  it("never lets a generation edge touch a row waiting on a live dependency", () => {
    const model = modelFor({
      docs: [doc({ blockedBy: ["live-leaf"], slug: OLD_GENERATION }), doc({ slug: "live-leaf", status: "ready" })],
      slug: OLD_GENERATION,
    });
    expect(model.section).toBe("NOT YET");
    expect(classifyBoardRow({ board: BOARD, model, supersession: GENERATION_EDGE }).verdict).toBe("UNWITNESSED");
  });

  it("never lets a generation edge touch a row paused on a person", () => {
    const model = modelFor({
      docs: [
        doc({ pausedOn: "a colleague", pausedSince: RECIPE_PAUSED_SINCE, slug: OLD_GENERATION, status: "paused" }),
      ],
      slug: OLD_GENERATION,
    });
    expect(model.section).toBe("PAUSED");
    expect(classifyBoardRow({ board: BOARD, model, supersession: GENERATION_EDGE }).verdict).toBe("UNWITNESSED");
  });

  it("never lets a generation edge touch a row paused on a person's review that names the recipe", () => {
    const pausedOn = "Alice's review of whether the vulnerability-fix-topup-acme-admin recipe is safe to re-enable";
    const model = modelFor({
      docs: [doc({ pausedOn, pausedSince: RECIPE_PAUSED_SINCE, slug: OLD_GENERATION, status: "paused" })],
      slug: OLD_GENERATION,
    });
    expect(model.section).toBe("PAUSED");
    expect(classifyBoardRow({ board: BOARD, model, supersession: GENERATION_EDGE }).verdict).toBe("UNWITNESSED");
  });

  it("names the measured row, paused on the recipe's next firing, but leaves its settle to a person", () => {
    const model = modelFor({
      docs: [doc({ pausedOn: RECIPE_PAUSE, pausedSince: RECIPE_PAUSED_SINCE, slug: OLD_GENERATION, status: "paused" })],
      slug: OLD_GENERATION,
    });
    expect(model.section).toBe("PAUSED");
    const candidate = classifyBoardRow({ board: BOARD, model, supersession: GENERATION_EDGE });
    expect(candidate.verdict).toBe("OVERTAKEN");
    expect(candidate.act).toBe("none");
    expect(candidate.witness).toBe(
      `${NEW_GENERATION} matches this row's top-up slug and batch brief with a later slug epoch, 2026-10-19T12:06:29.630Z, past this row's pause on that recipe's next firing — the board does not check whether the recipe made it, and ${SETTLE_WHEN}`,
    );
  });

  it("never names a row paused on the recipe's next firing when the later generation came before the pause", () => {
    const model = modelFor({
      docs: [
        doc({
          pausedOn: RECIPE_PAUSE,
          pausedSince: "2026-10-20T00:00:00.000Z",
          slug: OLD_GENERATION,
          status: "paused",
        }),
      ],
      slug: OLD_GENERATION,
    });
    expect(classifyBoardRow({ board: BOARD, model, supersession: GENERATION_EDGE }).verdict).toBe("UNWITNESSED");
  });

  it("never lets a generation edge touch a row declaring a probe, which apply re-reads unrun", () => {
    const model = modelFor({ docs: [doc({ doneWhen: [PRESENT_PROBE], slug: OLD_GENERATION })], slug: OLD_GENERATION });
    expect(classifyBoardRow({ board: BOARD, model, supersession: GENERATION_EDGE }).verdict).toBe("KEEP");
  });

  it("lets a dead dependency outrank a generation edge", () => {
    const model = modelFor({
      docs: [doc({ blockedBy: ["dead-leaf"], slug: OLD_GENERATION }), doc({ slug: "dead-leaf", status: "rejected" })],
      slug: OLD_GENERATION,
    });
    expect(classifyBoardRow({ board: BOARD, model, supersession: GENERATION_EDGE }).verdict).toBe("ORPHANED");
  });

  it("calls a row that declares no probe UNWITNESSED, and never offers an act on it", () => {
    const candidate = classifyBoardRow({
      board: BOARD,
      model: modelFor({ docs: [doc({ slug: "no-claim" })], slug: "no-claim" }),
      supersession: undefined,
    });
    expect(candidate.verdict).toBe("UNWITNESSED");
    expect(candidate.act).toBe("none");
    expect(candidate.witness).toContain("needs a witness or a detective");
  });

  it("distinguishes a row whose probes were NOT EVALUATED from one that declares none", () => {
    const candidate = classifyBoardRow({
      board: BOARD,
      model: modelFor({ docs: [doc({ doneWhen: [PRESENT_PROBE], slug: "never-probed" })], slug: "never-probed" }),
      supersession: undefined,
    });
    expect(candidate.verdict).toBe("KEEP");
    expect(candidate.act).toBe("none");
    expect(candidate.witness).toBe(
      "declares 1 probe(s) that this sweep did not evaluate — re-run with --probe and a longer --deadline",
    );
  });

  it("carries the row's own slug and path onto every candidate", () => {
    const candidate = classifyBoardRow({
      board: BOARD,
      model: modelFor({ docs: [doc({ slug: "named-row" })], slug: "named-row" }),
      supersession: undefined,
    });
    expect(candidate.slug).toBe("named-row");
    expect(candidate.path).toBe("/h/named-row.md");
  });
});

describe("classifyBoard", () => {
  it("classifies every model, in the models' own order", () => {
    const docs = [doc({ slug: "first-row" }), doc({ slug: "second-row" })];
    const candidates = classifyBoard({
      board: BOARD,
      closures: new Map(),
      models: modelsFor({ docs }),
      supersessions: new Map(),
    });
    expect(candidates.map((candidate) => candidate.slug)).toEqual(["first-row", "second-row"]);
  });

  it("applies a supersession edge to the row it names and to no other", () => {
    const docs = [doc({ slug: "old-row" }), doc({ slug: "new-row" })];
    const candidates = classifyBoard({
      board: BOARD,
      closures: new Map(),
      models: modelsFor({ docs }),
      supersessions: new Map([["old-row", { kind: "declared", newerSlug: "new-row" } as const]]),
    });
    expect(candidates.find((candidate) => candidate.slug === "old-row")!.verdict).toBe("SUPERSEDED");
    expect(candidates.find((candidate) => candidate.slug === "new-row")!.verdict).toBe("UNWITNESSED");
  });

  it("answers an empty list for an empty board", () => {
    expect(classifyBoard({ board: BOARD, closures: new Map(), models: [], supersessions: new Map() })).toEqual([]);
  });
});

describe("verdictCensus", () => {
  it("counts every verdict, including the ones that are zero", () => {
    const docs = [doc({ slug: "no-claim-a" }), doc({ slug: "no-claim-b" })];
    const census = verdictCensus({
      candidates: classifyBoard({
        board: BOARD,
        closures: new Map(),
        models: modelsFor({ docs }),
        supersessions: new Map(),
      }),
    });
    expect(census).toEqual({
      CONTRADICTED: 0,
      KEEP: 0,
      ORPHANED: 0,
      OVERTAKEN: 0,
      PR_ENDED: 0,
      SHIPPED: 0,
      SUPERSEDED: 0,
      UNCARDED: 0,
      UNWITNESSED: 2,
    });
  });

  it("reports every class as zero for an empty sweep, rather than an empty object", () => {
    expect(verdictCensus({ candidates: [] })).toEqual({
      CONTRADICTED: 0,
      KEEP: 0,
      ORPHANED: 0,
      OVERTAKEN: 0,
      PR_ENDED: 0,
      SHIPPED: 0,
      SUPERSEDED: 0,
      UNCARDED: 0,
      UNWITNESSED: 0,
    });
  });
});
