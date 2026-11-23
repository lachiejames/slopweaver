import { describe, expect, it } from "vitest";

import { askRowProblems, findingRulingState } from "../../../handover/askRow.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import { derivedRowState } from "../../../handover/derivedRowState.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { renderBoard } from "../../../handover/render.js";

/** A well-formed finding row — every field stated, because absence is what is under test. */
const row = (over: Partial<HandoverDoc> = {}): HandoverDoc => ({
  anchor: undefined,
  artifact: null as unknown as string,
  askedIso: "2026-09-02T06:14:01Z",
  baseBranch: undefined,
  blockedBy: [],
  branch: undefined,
  doneWhen: [],
  evidence: ["owner/repo#16360", "owner/repo#16384"],
  kind: "ask",
  notDoneReason: undefined,
  observedBy: "session-40",
  registeredBy: undefined,
  registeredRun: undefined,
  origin: "finding",
  outputs: [],
  pausedOn: undefined,
  pausedSince: undefined,
  risk: undefined,
  blastRadius: undefined,
  stillReal: undefined,
  stillRealIso: undefined,
  path: "/board/finding.md",
  priority: undefined,
  probeWaiver: undefined,
  lean: undefined,
  examples: [],
  exampleGap: undefined,
  options: [],
  problem: undefined,
  problems: [],
  repo: undefined,
  role: undefined,
  ruling: undefined,
  rulingAnchor: undefined,
  hisWords: { kind: "absent" },
  hisWordsSteers: [],
  settlement: undefined,
  settlementReason: undefined,
  settlementWitness: undefined,
  slug: "finding",
  status: "ready",
  statusSummary: undefined,
  supervisorState: undefined,
  summary: "watchPr.sh dies silent",
  ...over,
});

const problemsOf = ({ doc, declaredOrigin = "finding" }: { doc: HandoverDoc; declaredOrigin?: string | undefined }) =>
  askRowProblems({ declaredKind: "ask", declaredOrigin, doc });

/** The state, derived exactly as every production reader derives it — never a hand-built `DerivedRowState`. */
const stateOf = ({ doc, events = [] }: { doc: HandoverDoc; events?: readonly RunEvent[] }) =>
  findingRulingState({ derived: derivedRowState({ doc, events }), doc });

/** A ruling recorded because the owner ruled — the kind that clears a door. */
const LIVE_RULING: RunEvent = {
  anchor: "https://example.invalid/p9",
  atIso: "2026-09-10T00:00:00.000Z",
  decidedIso: "2026-09-10T00:00:00.000Z",
  kind: "ruling",
  ruling: "yes, raise it",
};

/** The answer a backfilled ruling is reconstructed from, and the ruling itself. */
const ANSWERED: RunEvent = { answer: "OWNER RULED: ship it", atIso: "2026-09-04T00:00:00.000Z", kind: "answered" };
const BACKFILLED_RULING: RunEvent = {
  anchor: "journal:runs/finding.jsonl#2026-09-04T00:00:00.000Z",
  atIso: "2026-09-13T00:00:00.000Z",
  backfilledFrom: "2026-09-04T00:00:00.000Z",
  decidedIso: "2026-09-04T00:00:00.000Z",
  kind: "ruling",
  ruling: "OWNER RULED: ship it",
};

describe("askRowProblems on a finding row", () => {
  it("finds nothing wrong with a finding that says who saw it and what they saw", () => {
    expect(problemsOf({ doc: row() })).toEqual([]);
  });

  it("reports an origin the board swallowed, so a typo cannot quietly make a finding read as the owner's ask", () => {
    const doc = row({ evidence: [], observedBy: undefined, origin: undefined });
    expect(problemsOf({ declaredOrigin: "Finding", doc })).toEqual([
      'origin: "Finding" is not an origin a row may declare — use finding',
    ]);
  });

  it("refuses a finding with no observing session", () => {
    expect(problemsOf({ doc: row({ observedBy: undefined }) })).toEqual([
      "a finding row declares no observedBy — which session saw it is what makes its origin checkable",
    ]);
  });

  it("refuses a finding with no evidence", () => {
    expect(problemsOf({ doc: row({ evidence: [] }) })).toEqual([
      "a finding row declares no evidence — what was observed is the whole reason the row exists",
    ]);
  });

  it("refuses provenance fields on the owner's own ask, where they would claim an origin the row does not declare", () => {
    const doc = row({ origin: undefined });
    expect(problemsOf({ declaredOrigin: undefined, doc })).toEqual([
      "observedBy, evidence and ruling are only meaningful with `origin: finding` — declare it or remove them",
    ]);
  });

  it("refuses a ruling with no anchor, and an anchor with no ruling", () => {
    expect(problemsOf({ doc: row({ ruling: "yes" }) })).toEqual([
      "ruling and rulingAnchor come as a pair — the owner's words, and where they said them",
    ]);
    expect(problemsOf({ doc: row({ rulingAnchor: "https://example.invalid/p9" }) })).toEqual([
      "ruling and rulingAnchor come as a pair — the owner's words, and where they said them",
    ]);
  });

  it("refuses finding fields on a doc row, by name", () => {
    const doc = row({ kind: "doc" });
    expect(askRowProblems({ declaredKind: "doc", declaredOrigin: "finding", doc })).toEqual([
      "askedIso, origin, observedBy, evidence are only meaningful on an ask row — declare `kind: ask` or remove them",
    ]);
  });
});

describe("findingRulingState", () => {
  it("stays unruled on a finding whose only ruling was reconstructed from an answer", () => {
    expect(stateOf({ doc: row(), events: [ANSWERED, BACKFILLED_RULING] })).toBe("unruled");
  });

  it("is ruled by a recorded live ruling, and a later backfill does not take that away", () => {
    expect(stateOf({ doc: row(), events: [LIVE_RULING] })).toBe("ruled");
    expect(stateOf({ doc: row(), events: [ANSWERED, LIVE_RULING, BACKFILLED_RULING] })).toBe("ruled");
  });

  it("is not-a-finding for the owner's own ask", () => {
    expect(stateOf({ doc: row({ evidence: [], observedBy: undefined, origin: undefined }) })).toBe("not-a-finding");
  });

  it("is unruled until both their words and their anchor are on the row", () => {
    expect(stateOf({ doc: row() })).toBe("unruled");
    expect(stateOf({ doc: row({ ruling: "yes" }) })).toBe("unruled");
  });

  it("is ruled once both are present", () => {
    expect(stateOf({ doc: row({ ruling: "yes", rulingAnchor: "https://example.invalid/p9" }) })).toBe("ruled");
  });

  it("is declined when the owner settled it so, whatever ruling was recorded before", () => {
    const doc = row({
      ruling: "yes",
      rulingAnchor: "https://example.invalid/p9",
      settlement: "declined",
      settlementReason: "no memory of asking",
      settlementWitness: "https://example.invalid/pr/16658",
    });
    expect(stateOf({ doc })).toBe("declined");
  });
});

describe("a finding row through the real parser", () => {
  const text = [
    "---",
    "slug: watchpr-dies",
    "kind: ask",
    'summary: "watchPr.sh dies silent"',
    "status: ready",
    "askedIso: 2026-09-02T06:14:01Z",
    "origin: finding",
    "observedBy: session-40",
    "evidence: [owner/repo#16360, owner/repo#16384]",
    "blockedBy: []",
    "artifact: null",
    "doneWhen: []",
    "---",
    "",
    "# watchPr.sh dies silent",
    "",
  ].join("\n");

  it("reads origin, observer and evidence off the front-matter", () => {
    const doc = parseHandoverDoc({ path: "/h/watchpr-dies.md", text });

    expect(doc.problems).toEqual([]);
    expect(doc.origin).toBe("finding");
    expect(doc.observedBy).toBe("session-40");
    expect(doc.evidence).toEqual(["owner/repo#16360", "owner/repo#16384"]);
    expect(stateOf({ doc })).toBe("unruled");
  });
});

describe("the board shows a finding row's origin", () => {
  const boardFor = ({ doc, events = [] }: { doc: HandoverDoc; events?: readonly RunEvent[] }) =>
    renderBoard({
      models: composeBoardModels({
        journals: new Map([[doc.slug, { events, unreadableLines: [] }]]),
        probeStates: new Map(),
        resolutionDocs: [doc],
        roots: [doc],
      }),
      unreadable: [],
    });

  it("prints where an unruled finding came from and that a team-facing door refuses it", () => {
    const lines = boardFor({ doc: row({ slug: "watchpr-dies" }) });

    expect(lines).toContain(
      "      origin: a fleet finding, observed by session-40 from owner/repo#16360, owner/repo#16384",
    );
    expect(lines).toContain(
      "      doors:  SHUT — a pull request on a team base or a review ask is refused until `handover rule` records the owner's word on this finding",
    );
  });

  it("prints the owner's ruling and its anchor once recorded, and says the front-matter is where it came from", () => {
    const lines = boardFor({
      doc: row({ ruling: "yes, raise it", rulingAnchor: "https://example.invalid/p9", slug: "w" }),
    });

    expect(lines).toContain("      ruling: yes, raise it (https://example.invalid/p9)");
    expect(lines).toContain(
      "              recorded in the row's own front-matter, before rulings became register events",
    );
  });

  it("prints a ruling recorded as an event, with the instant they decided it", () => {
    const lines = boardFor({ doc: row({ slug: "w" }), events: [LIVE_RULING] });

    expect(lines).toContain("      ruling: yes, raise it (https://example.invalid/p9)");
    expect(lines).toContain("              recorded when the owner ruled, decided 2026-09-10T00:00:00.000Z");
  });

  it("prints a BACKFILLED ruling and still says the team-facing doors are shut", () => {
    const lines = boardFor({ doc: row(), events: [ANSWERED, BACKFILLED_RULING] });

    expect(lines).toContain("      ruling: OWNER RULED: ship it (journal:runs/finding.jsonl#2026-09-04T00:00:00.000Z)");
    expect(lines).toContain(
      "              reconstructed from this row's answer of 2026-09-04T00:00:00.000Z — a record, not a team-facing permission",
    );
    expect(lines).toContain(
      "      doors:  SHUT — a pull request on a team base or a review ask is refused until `handover rule` records the owner's word on this finding",
    );
  });

  it("prints no origin line at all for the owner's own ask", () => {
    const lines = boardFor({ doc: row({ evidence: [], observedBy: undefined, origin: undefined, slug: "own-ask" }) });

    expect(lines.some((line) => line.includes("origin:"))).toBe(false);
  });
});
