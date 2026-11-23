/**
 * The board the `handover list --json` cases build: a blank handover doc with per-case overrides, the journal
 * shape `composeBoardModels` reads per slug, and the composition that turns both into board models.
 */
import { composeBoardModels } from "../../../../handover/boardState.js";
import { type BoardModel } from "../../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../../handover/doc.js";
import type { RunEvent } from "../../../../handover/ledger.js";

/** The instant every board document in these cases says it was observed at. */
export const OBSERVED = "2026-09-19T10:00:00.000Z";
/** The instant every board document in these cases says its scan started at. */
export const SCAN_STARTED = "2026-09-19T09:59:30.000Z";

/**
 * A handover doc with every field blank bar the few a case names, under `/h/<slug>.md` in `/w/repo`.
 *
 * @param status the authored front-matter status, `ready` unless named
 * @param kind whether it is a plain doc or an ask, `doc` unless named
 * @param blockedBy slugs the dependency pass must see finish first
 * @param summary the authored summary, `what <slug> does` unless named
 * @returns the doc
 */
// max-lines-exempt: one blank HandoverDoc literal, one line per field of that type, moved verbatim out of a test file this gate skips
export function doc({
  slug,
  status = "ready",
  kind = "doc",
  priority,
  blockedBy = [],
  summary = `what ${slug} does`,
}: {
  slug: string;
  status?: HandoverDoc["status"];
  kind?: HandoverDoc["kind"];
  priority?: HandoverDoc["priority"];
  blockedBy?: readonly string[];
  summary?: HandoverDoc["summary"];
}): HandoverDoc {
  return {
    anchor: undefined,
    artifact: undefined,
    askedIso: undefined,
    baseBranch: undefined,
    blockedBy,
    branch: undefined,
    doneWhen: [],
    evidence: [],
    kind,
    notDoneReason: undefined,
    observedBy: undefined,
    registeredBy: undefined,
    registeredRun: undefined,
    origin: undefined,
    outputs: [],
    path: `/h/${slug}.md`,
    pausedOn: undefined,
    pausedSince: undefined,
    risk: undefined,
    blastRadius: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    priority,
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
    summary,
    supervisorState: undefined,
  };
}

/** What `composeBoardModels` reads per slug — the events plus whatever lines could not be decoded. */
export interface Journal {
  readonly events: readonly RunEvent[];
  readonly unreadableLines: readonly number[];
}

/**
 * The board models a set of docs and their journals compose to, with no probe evidence.
 *
 * @param docs every doc on the board, each both a root and a resolution target
 * @param journals each run's journal keyed by slug, none unless named
 * @returns the composed models
 */
export function modelsFor({
  docs,
  journals = new Map<string, Journal>(),
}: {
  docs: readonly HandoverDoc[];
  journals?: ReadonlyMap<string, Journal>;
}): readonly BoardModel[] {
  return composeBoardModels({ journals, probeStates: new Map(), resolutionDocs: docs, roots: docs });
}
