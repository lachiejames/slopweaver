/**
 * Whether the fleet is looking into an open incident, and why — the quiet half of an investigation, printed beside
 * the incident by `slopweaver org-health status`.
 *
 * The owner gets a subtle visual indication that the fleet is looking into a thing, and a reason on request, but no
 * floating note until there is something ready for their attention. Open takes them to the Queue card holding the
 * finding to share, never to the incident's own page. So an incident a board row is investigating carries one {@link Investigation}: lined up, looking, or its
 * findings ready — and ready links the Queue card that holds them, never the incident page.
 *
 * ## Which row is investigating which incident
 *
 * An investigation is a board row whose slug starts `incident-`: the sweep's `incident-<channel id lowered>`
 * (`../incident/row.ts`), or one a session registered by hand. It names its incident by the incident's homepage
 * address or its Slack channel id, each matched on a BOUNDARY: `…/incidents/3` is a prefix of the INC-33 address,
 * and a channel id inside a longer token is another id. A bare `INC-33` is
 * never a match — it appears in far more prose than an investigation's own row. A row naming two open incidents is
 * the investigation of the one it names FIRST: a write-up citing an older incident for contrast is not looking into
 * that one too.
 *
 * ## What each state rests on
 *
 * The row's run journal, read by the board's own `runDisposition`, never by a journal merely existing: a tagged
 * registration and a chair's dispatch both write one before any seat starts. Findings are ready when the
 * incident's own note is up on the row — an open hand step whose id is that incident's note id
 * (`../incident/note.ts`), opening as `hand:<id>` — or when the run's question is the owner's by the board's own
 * `ownerWaitOf`, opening as `ask:<slug>`: the same verdict that stands the Queue's ask card up, so a link here
 * never names a card the Queue does not draw (a seat can end in a recorded question and
 * post no note). A question the owner has already ruled on waits on a session, so it is lined up again; a paused row is
 * nobody's work. A row whose read failed is `unmeasured`, never `none`.
 *
 * Pure: the docs, journals and hand steps are read by `./investigationRead.ts`.
 */
import { fitLine } from "../hand/push/notice.js";
import type { RunDisposition } from "../handover/boardTypes.js";
import { type OwnerWaitKind, waitsOnOwner } from "../handover/ownerWait.js";
import { incidentNoteIdPattern } from "../incident/note.js";
import { askNamesChannel } from "../incident/row.js";

import type { OrgIncident } from "./types.js";

/** The slug every investigation row opens with, so the reader lists four files rather than the whole board. */
export const INVESTIGATION_SLUG_PREFIX = "incident-";

/** How long the why may run on its `org-health status` line: it is a pointer, not the findings. */
const WHY_CAP = 240;

/** Where the fleet has got to with one open incident. */
export type Investigation =
  | { readonly state: "none" }
  | { readonly state: "lined-up"; readonly slug: string; readonly why: string }
  | { readonly state: "looking"; readonly slug: string; readonly why: string; readonly lastMovedIso: string }
  /** `open` is the Queue key the findings' card answers to: `hand:<note id>` or `ask:<slug>`. */
  | { readonly state: "findings"; readonly slug: string; readonly why: string; readonly open: string }
  | { readonly state: "unmeasured"; readonly because: string };

/** One live board row that might be investigating an incident, with what its journal says. */
export interface InvestigationRow {
  readonly slug: string;
  /** The row's summary — what the registering session wrote it is for. */
  readonly summary: string;
  /** Whether the row is over: a terminal status or a settlement, register-first as the board derives it. */
  readonly over: boolean;
  /** Whether the row is paused: nobody's work until somebody resumes it. */
  readonly paused: boolean;
  readonly run: RunDisposition;
  /** The board's verdict on its open question — only the owner's is a card on the Queue. */
  readonly ownerWait: OwnerWaitKind;
  /** The instant of the journal's last event, absent for a row with no journal. */
  readonly lastMovedIso: string | undefined;
  /** Where the row came from, when its registering run is another row on the board. */
  readonly raisedBy: RaisedBy | undefined;
}

/** The row a session was working when it registered this one — the "I was in the middle of …" half of the why. */
export type RaisedBy = { readonly kind: "supervisor" } | { readonly kind: "row"; readonly summary: string };

/** An open hand step that names a board row. */
export interface RowStep {
  readonly id: string;
  readonly row: string;
}

/** What an investigation reads off an open incident. */
type IncidentKey = Pick<OrgIncident, "ref" | "homepageUrl" | "channelId">;

/**
 * Where `text` first names `needle` with nothing word-like either side of it.
 *
 * @param text the prose searched
 * @param needle the address or id it must carry whole
 * @param after the characters that would make the match a longer token
 * @returns the index of the first whole match, or `undefined` when there is none
 */
function wholeAt({ text, needle, after }: { text: string; needle: string; after: RegExp }): number | undefined {
  let from = text.indexOf(needle);
  while (from !== -1) {
    const before = text.charAt(from - 1);
    const next = text.charAt(from + needle.length);
    if (!/[A-Za-z0-9]/u.test(before) && !after.test(next)) {
      return from;
    }
    from = text.indexOf(needle, from + 1);
  }
  return undefined;
}

/** Where a summary first names an incident, by address or channel id, or `undefined` when it never does. */
function namedAt({
  summary,
  incident,
}: {
  summary: string;
  incident: Pick<OrgIncident, "homepageUrl" | "channelId">;
}): number | undefined {
  const byAddress = wholeAt({ after: /[A-Za-z0-9_-]/u, needle: incident.homepageUrl, text: summary });
  if (incident.channelId === undefined) {
    return byAddress;
  }
  const byChannel = wholeAt({ after: /[A-Za-z0-9]/u, needle: incident.channelId, text: summary });
  if (byAddress === undefined) {
    return byChannel;
  }
  if (byChannel === undefined) {
    return byAddress;
  }
  return Math.min(byAddress, byChannel);
}

/**
 * Whether a row's summary names this incident: its homepage address with no further path segment or digit after
 * it, or its Slack channel id as a whole token.
 *
 * @param summary the row's summary
 * @param incident the open incident
 * @returns true when the row is about this incident
 */
export function rowNamesIncident({
  summary,
  incident,
}: {
  summary: string;
  incident: Pick<OrgIncident, "homepageUrl" | "channelId">;
}): boolean {
  return namedAt({ incident, summary }) !== undefined;
}

/**
 * The open incident a row investigates: the one its summary names first, the first listed on a tie.
 *
 * @param summary the row's summary
 * @param open every open incident
 * @returns that incident's reference, or `undefined` when the row names none of them
 */
export function investigatedIncident({
  summary,
  open,
}: {
  summary: string;
  open: readonly IncidentKey[];
}): string | undefined {
  let first: { readonly ref: string; readonly at: number } | undefined;
  for (const incident of open) {
    const at = namedAt({ incident, summary });
    if (at !== undefined && (first === undefined || at < first.at)) {
      first = { at, ref: incident.ref };
    }
  }
  return first?.ref;
}

/**
 * Why the fleet is looking into it, in a line the owner reads on hover.
 *
 * A swept row says the sweep found the channel: its own ask is the procedure, not a reason. A row raised while
 * working another row quotes that row, saying what the fleet was in the middle of;
 * one the supervisor raised says so rather than printing a shift's slug.
 *
 * @param row the matched row
 * @param incident the incident it names
 * @returns the why, at most {@link WHY_CAP} characters
 */
export function investigationWhy({
  row,
  incident,
}: {
  row: InvestigationRow;
  incident: Pick<OrgIncident, "channelId">;
}): string {
  if (incident.channelId !== undefined && askNamesChannel({ ask: row.summary, channelId: incident.channelId })) {
    return "the incident sweep found its channel live, and mid-incident is when a finding helps most";
  }
  const own = firstSentence({ text: row.summary });
  if (row.raisedBy === undefined) {
    return capped({ text: own });
  }
  if (row.raisedBy.kind === "supervisor") {
    return capped({ text: `raised by the supervisor: ${own}` });
  }
  return capped({ text: `found while working on "${firstSentence({ text: row.raisedBy.summary })}": ${own}` });
}

/** The first sentence of a summary: up to a terminator followed by whitespace, so an address's dots stay. */
function firstSentence({ text }: { text: string }): string {
  const collapsed = text.replaceAll(/\s+/gu, " ").trim();
  const end = /[.!?](?=\s)/u.exec(collapsed);
  if (end === null) {
    return collapsed;
  }
  return collapsed.slice(0, end.index + 1);
}

/** A line fitted to {@link WHY_CAP}, marked when it was cut. */
function capped({ text }: { text: string }): string {
  const fitted = fitLine({ cap: WHY_CAP - 1, text });
  if (fitted === text.trim()) {
    return fitted;
  }
  return `${fitted}…`;
}

/**
 * The investigation as one line a person reads under its incident, as `org-health status` prints it.
 *
 * @param investigation the incident's investigation
 * @returns the line, or `undefined` when nobody is looking into it
 */
export function investigationLine({ investigation }: { investigation: Investigation }): string | undefined {
  switch (investigation.state) {
    case "none":
      return undefined;
    case "lined-up":
      return `lined up for the fleet to look into — ${investigation.why}`;
    case "looking":
      return `the fleet is looking into this (last moved ${investigation.lastMovedIso}) — ${investigation.why}`;
    case "findings":
      return `findings ready on the Queue, ${investigation.open} — ${investigation.why}`;
    case "unmeasured":
      return `investigation not measured — ${investigation.because}`;
    default: {
      const unhandled: never = investigation;
      return unhandled;
    }
  }
}

/** Each state's rank when two rows name one incident: the furthest along is what the owner sees. */
const RANK: Readonly<Record<Investigation["state"], number>> = {
  findings: 4,
  "lined-up": 2,
  looking: 3,
  none: 0,
  unmeasured: 1,
};

/**
 * The incident's own note, up on this row: an open step naming the row whose id is that incident's note id.
 *
 * @param row the matched row's slug
 * @param incident the incident it investigates
 * @param steps every open hand step that names a row
 * @returns the step's id, or `undefined` when no note of this incident is up on the row
 */
function incidentNoteOn({
  row,
  incident,
  steps,
}: {
  row: string;
  incident: Pick<OrgIncident, "channelId">;
  steps: readonly RowStep[];
}): string | undefined {
  if (incident.channelId === undefined) {
    return undefined;
  }
  const pattern = incidentNoteIdPattern({ channelId: incident.channelId });
  return steps.find((step) => step.row === row && pattern.test(step.id))?.id;
}

/**
 * Findings on the Queue card `open` — or lined up once the owner's words have landed on it, since the Queue then holds the
 * card off until a session acts on them.
 *
 * @param heard whether the owner's spoken words have landed on the card
 * @param open the card's Queue key
 * @param slug the row's slug
 * @param why the one sentence naming why the fleet took it up
 * @returns the state
 */
function findingsOn({
  heard,
  open,
  slug,
  why,
}: {
  heard: boolean;
  open: string;
  slug: string;
  why: string;
}): Investigation {
  if (heard) {
    return { slug, state: "lined-up", why };
  }
  return { open, slug, state: "findings", why };
}

/**
 * Whether the owner's words have landed on the row's ask card. A decision step on the row answers `ask:<slug>` in the
 * ask card's place, so the owner's words on either hold it off.
 *
 * @param landed the Queue keys the owner's spoken words are holding off the Queue
 * @param open the ask card's Queue key
 * @param slug the row's slug
 * @param steps every open hand step that names a row
 * @returns true when either card is held off
 */
function askHeard({
  landed,
  open,
  slug,
  steps,
}: {
  landed: ReadonlySet<string>;
  open: string;
  slug: string;
  steps: readonly RowStep[];
}): boolean {
  if (landed.has(open)) {
    return true;
  }
  return steps.some((step) => step.row === slug && landed.has(`hand:${step.id}`));
}

/**
 * One row's investigation of the incident, or `none` when the row is over, paused, or its run ended without
 * findings.
 *
 * @param row the matched row
 * @param incident the incident it investigates
 * @param steps every open hand step that names a row
 * @param landed the Queue keys the owner's spoken words are holding off the Queue (`talk cards`)
 * @returns the state
 */
function rowInvestigation({
  row,
  incident,
  steps,
  landed,
}: {
  row: InvestigationRow;
  incident: Pick<OrgIncident, "channelId">;
  steps: readonly RowStep[];
  landed: ReadonlySet<string>;
}): Investigation {
  if (row.over) {
    return { state: "none" };
  }
  const why = investigationWhy({ incident, row });
  const note = incidentNoteOn({ incident, row: row.slug, steps });
  if (note !== undefined) {
    const open = `hand:${note}`;
    return findingsOn({ heard: landed.has(open), open, slug: row.slug, why });
  }
  const { run } = row;
  if (run.kind === "unreadable") {
    return { because: `${row.slug}'s run journal would not read: ${run.reason}`, state: "unmeasured" };
  }
  if (waitsOnOwner({ ownerWait: row.ownerWait })) {
    const open = `ask:${row.slug}`;
    return findingsOn({ heard: askHeard({ landed, open, slug: row.slug, steps }), open, slug: row.slug, why });
  }
  if (row.paused) {
    return { state: "none" };
  }
  // Ruled on since it asked: the run waits on a session acting on the owner's word, which is lined up, not findings.
  if (row.ownerWait === "already-ruled") {
    return { slug: row.slug, state: "lined-up", why };
  }
  if (run.kind === "active") {
    if (row.lastMovedIso === undefined) {
      return { because: `${row.slug}'s run reads active with no journal instant`, state: "unmeasured" };
    }
    return { lastMovedIso: row.lastMovedIso, slug: row.slug, state: "looking", why };
  }
  // A seat that died is a row the chair reseats, and a dispatch nobody started is one it seats: lined up, both.
  if (run.kind === "never-started" || run.kind === "orphaned") {
    return { slug: row.slug, state: "lined-up", why };
  }
  return { state: "none" };
}

/**
 * Where the fleet has got to with each open incident, across every live row that investigates it.
 *
 * @param open every open incident
 * @param rows every live investigation row the reader found, whichever incident they name
 * @param steps every open hand step that names a row
 * @param landed the Queue keys the owner's spoken words are holding off the Queue
 * @returns each incident's furthest-along state, keyed by its reference — `none` when no row investigates it
 */
export function incidentInvestigations({
  open,
  rows,
  steps,
  landed,
}: {
  open: readonly IncidentKey[];
  rows: readonly InvestigationRow[];
  steps: readonly RowStep[];
  landed: ReadonlySet<string>;
}): ReadonlyMap<string, Investigation> {
  const best = new Map<string, Investigation>(open.map((incident) => [incident.ref, { state: "none" }]));
  for (const row of rows) {
    const ref = investigatedIncident({ open, summary: row.summary });
    const incident = open.find((candidate) => candidate.ref === ref);
    if (incident === undefined) {
      continue;
    }
    const next = rowInvestigation({ incident, landed, row, steps });
    if (RANK[next.state] > RANK[best.get(incident.ref)!.state]) {
      best.set(incident.ref, next);
    }
  }
  return best;
}
