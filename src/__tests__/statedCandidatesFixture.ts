/**
 * Synthetic stated candidates — the shape an installation's `workstreams/stated-candidates.json` carries, with acme
 * content and never any installation's own rows.
 *
 * Twelve rows, so a test can keep a whole set: eight filed under `self`, four under `team`. Each subject row carries
 * ONE of the words the frozen tick-zero reconciliation's synthetic board rows are labelled with
 * (`fixtures/supervisor/handoff-9263-tick-zero/reconcile.json`), so the replay of that tick sees every row sit under the
 * outcomes it sat under then. One row is a rank band; one names the bot, by the extra matcher `the bot` no frozen
 * label carries and by the install's handles; and one has a former title.
 *
 * `writeStatedCandidatesFile` writes the document into a test's own `mkdtempSync` home; nothing here reads or writes
 * the ambient one.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { stateHomePaths } from "../stateHome.js";
import type { BoardMembership } from "../workstreams/boardMembership.js";
import type { Candidate } from "../workstreams/candidates.js";

/** The first number a synthetic stated row takes, far above any mined fixture's. */
const FIRST_N = 901;

/** The day every synthetic row was stated. */
const SAID = "2026-01-05";

/** The synthetic transcript turn every row is anchored to. */
const ANCHOR = "transcript:00000000-0000-4000-8000-000000000001#00000000-0000-4000-8000-000000000002";

/** One synthetic row before it is a candidate: only what differs from row to row. */
interface Row {
  readonly id: string;
  readonly title: string;
  readonly words: string;
  readonly boardMembership: BoardMembership;
  readonly workspace: Candidate["workspace"];
}

/** Every synthetic row, in statement order. */
const ROWS: readonly Row[] = [
  {
    boardMembership: { kind: "subject", matchers: ["schema"] },
    id: "acme-schema-applied",
    title: "The acme schema applied, every table populated",
    words: "The acme schema is applied, with every table populated",
    workspace: "self",
  },
  {
    boardMembership: { kind: "subject", matchers: ["home data"] },
    id: "acme-home-data-moved",
    title: "The acme home data moved into the shared store",
    words: "The acme home data has moved into the shared store",
    workspace: "self",
  },
  {
    boardMembership: { kind: "subject", matchers: ["backfill"] },
    id: "acme-backfill-current",
    title: "Every acme backfill complete and kept current",
    words: "Every acme backfill is complete and kept current",
    workspace: "self",
  },
  {
    boardMembership: { kind: "subject", matchers: ["notion"] },
    id: "acme-notion-included",
    title: "The acme Notion workspace included in the corpus",
    words: "The acme Notion workspace is included in the corpus",
    workspace: "self",
  },
  {
    boardMembership: { kind: "subject", matchers: ["dogfood", "the bot"], namesTheBot: true },
    id: "acme-bot-dogfooded",
    title: "The acme bot dogfooded daily, its bugs fixed as found",
    words: "The acme bot is dogfooded daily, with its bugs fixed as they are found",
    workspace: "self",
  },
  {
    boardMembership: { band: 200, kind: "rank-band" },
    id: "acme-top-rows-fixed",
    title: "The top acme board rows acted on and fixed",
    words: "The top acme board rows are each acted on and fixed",
    workspace: "self",
  },
  {
    boardMembership: { kind: "subject", matchers: ["ratchet"] },
    id: "acme-ratchets-complete",
    title: "Every acme ratchet driven to zero",
    words: "Every acme ratchet is driven to zero",
    workspace: "self",
  },
  {
    boardMembership: { kind: "subject", matchers: ["backup"] },
    id: "acme-backups-scheduled",
    title: "Scheduled acme backups landing off the machine",
    words: "Scheduled acme backups land off the machine",
    workspace: "self",
  },
  {
    boardMembership: { kind: "subject", matchers: ["merge queue"] },
    id: "acme-green-prs-merged",
    title: "The owner's green acme pull requests merged unasked",
    words: "A green acme pull request of the owner's is merged without asking",
    workspace: "team",
  },
  {
    boardMembership: { kind: "subject", matchers: ["reviewer"] },
    id: "acme-reviewers-bumped",
    title: "The owner's acme pull requests waiting on a reviewer bumped",
    words: "An acme pull request of the owner's waiting on a reviewer is bumped to them",
    workspace: "team",
  },
  {
    boardMembership: { kind: "subject", matchers: ["rebase"] },
    id: "acme-stalled-prs-handled",
    title: "The owner's stalled acme pull requests rebased and handled",
    words: "An acme pull request of the owner's stalled on a conflict is rebased and handled",
    workspace: "team",
  },
  {
    boardMembership: { kind: "subject", matchers: ["slack thread"] },
    id: "acme-threads-moved",
    title: "Every acme slack thread moved along, pausing only for the owner",
    words: "Each acme slack thread is moved along, pausing only where the owner's judgement is owed",
    workspace: "team",
  },
];

/**
 * One synthetic row as the candidate a stated-candidates file carries.
 *
 * @param position where it sits in statement order, from zero, which fixes its number
 * @returns the candidate
 */
function candidateOf({ row, position }: { row: Row; position: number }): Candidate {
  return {
    boardMembership: row.boardMembership,
    doneOptions: [],
    evidence: [{ anchor: ANCHOR, date: SAID, href: null, quote: row.words }],
    evidenceCount: 1,
    first: SAID,
    id: row.id,
    inRegister: null,
    last: SAID,
    loopIn: [],
    n: FIRST_N + position,
    name: row.title,
    outcome: row.words,
    owningTeam: null,
    people: [],
    priorSteers: [],
    proposal: null,
    stalled: null,
    theme: "stated outcome",
    workspace: row.workspace,
  };
}

/** Every synthetic stated candidate, in statement order. */
export const SYNTHETIC_STATED: readonly Candidate[] = ROWS.map((row, position) => candidateOf({ position, row }));

/** The one synthetic stated row that has had another title, and that exact former title. */
export const SYNTHETIC_FORMER: { readonly id: string; readonly title: string } = {
  id: "acme-green-prs-merged",
  title: "Green acme pull requests merged without asking",
};

/**
 * A whole stated-candidates document.
 *
 * @param candidates the rows it carries, every synthetic one when absent
 * @param formerNames exact former titles by id, the one synthetic former title when absent
 * @returns the document, ready to serialise
 */
export function statedCandidatesDocument({
  candidates = SYNTHETIC_STATED,
  formerNames = { [SYNTHETIC_FORMER.id]: SYNTHETIC_FORMER.title },
}: {
  candidates?: readonly Candidate[];
  formerNames?: Readonly<Record<string, string>>;
} = {}): { schemaVersion: 1; candidates: readonly Candidate[]; formerNames: Readonly<Record<string, string>> } {
  return { candidates, formerNames, schemaVersion: 1 };
}

/**
 * Write a stated-candidates file into a test's own home.
 *
 * @param home the test's `mkdtempSync` home
 * @param document what to write, the whole synthetic document when absent; any value, so a test can write a bad one
 * @returns the path written
 */
export function writeStatedCandidatesFile({
  home,
  document = statedCandidatesDocument(),
}: {
  home: string;
  document?: unknown;
}): string {
  const path = stateHomePaths({ home }).workstreamsStatedCandidatesJson;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  return path;
}
