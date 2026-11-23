/**
 * The approved-draft tick gate's shell half: its one read of the Slack draft register, its hatch, and its refusal's
 * text. The verdict is `../../../supervisor/approvedDraftGate.ts`, composed with the other gates in
 * `./tickRecordGates.ts` for `supervisor tick-record` and `supervisor tick close` alike.
 */
import { readSlackDraftLinesOrError } from "../../../admit/slackDraftStore.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchOpen } from "../../../hatch/open.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { slopweaverHome } from "../../../homeDir.js";
import { isRecord } from "../../../lib/parsers.js";
import { foldSlackDrafts } from "../../../outbound/slack/draftFold.js";
import { parseSlackDraftLog, type SkippedSlackDraftLine } from "../../../outbound/slack/draftLog.js";
import type { SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import {
  type ApprovedDraftRead,
  type ApprovedDraftVerdict,
  judgeApprovedDrafts,
  type UnreadApprovedRow,
} from "../../../supervisor/approvedDraftGate.js";
import type { AnswerContext } from "../../../talk/answerContext.js";
import { readAnswerContexts } from "../../../talk/answerContextRead.js";
import { draftReleaseCommand } from "../slack/draftReport.js";
import { HEARD_CHARS, LANDED_ROUTE, landedDraft, landingHead, STATE_UNKNOWN } from "./approvedDraftLandings.js";
import { readLandedDraftBindings } from "./landedCardReads.js";

/**
 * Whether the `approved-draft-held` hatch is open.
 *
 * @returns true when the ambient variable or a journalled grant opens it
 */
export function approvedDraftHatchOpenLive(): boolean {
  return hatchOpen({
    env: process.env,
    id: "approved-draft-held",
    nowIso: new Date().toISOString(),
  });
}

/**
 * The draft register, read once and folded — every row its readable events fold to, the rows a passed-over line names,
 * and how many lines it passed over — and every active card landing bound to the held drafts its card names.
 *
 * @param home the Slopweaver home the register and ledgers live under, or the ambient one
 * @returns the rows, the bindings and what is unsure about them, or why either could not be read
 */
export function readApprovedDraftsLive({ home }: { home: string | undefined }): ApprovedDraftRead {
  const lines = readSlackDraftLinesOrError(home === undefined ? {} : { home });
  if (lines.isErr()) {
    return { kind: "unreadable", why: lines.error.message };
  }
  const log = parseSlackDraftLog({ lines: lines.value });
  // Every row, not the display fold: that hides a row a passed-over line names, and hidden is not released.
  const unsureIds = log.skipped.flatMap((line) => (line.id === undefined ? [] : [line.id]));
  const items = foldSlackDrafts({ events: log.events });
  // A park the fold shows held — that same park, by its instant — is the fold's to judge: named with its release command
  // when it owes one, and clean when a later `held` set its approval down. The walk owes only the rest.
  const shown = new Map(
    items.filter((item) => item.state === "held").map((item) => [item.id, item.draft.tsIso] as const),
  );
  const unshown = approvedParksUnspent({
    lines: lines.value,
    skipped: new Map(log.skipped.map((line) => [line.line, line] as const)),
  }).filter((row) => !(shown.has(row.id) && shown.get(row.id) === row.tsIso));
  const landingHome = landingHomeOf({ home });
  const landings = readLandedDraftBindings({ home: landingHome, items, skipped: log.skipped });
  if (landings.kind === "unreadable") {
    return landings;
  }
  const anchors = [...landings.bindings.bound, ...landings.bindings.unreadable].map((one) => one.landing.anchor);
  return {
    answers: readAnswerContexts({ anchors, home: landingHome }),
    items,
    kind: "read",
    landings: landings.bindings,
    skippedLines: log.skipped.length,
    unreadApproved: unshown,
    unsureIds,
  };
}

/** The home the landing ledger is read under: the one passed, else the ambient one the register read resolved. */
function landingHomeOf({ home }: { home: string | undefined }): string {
  if (home === undefined) {
    return slopweaverHome();
  }
  return home;
}

/**
 * Walk the register in FILE ORDER: every `parked` line carrying an `approval`, readable or not, is owed until a READABLE
 * release or drop AFTER it spends it. Order is the point — a drop written before the park spends nothing,
 * and a later park under the same id spends nothing either, though the fold shows only that one. So
 * EVERY unspent approved park is kept and the deadline judges each: one park replacing another, in either file order,
 * would carry a pre-tick obligation past the deadline (concurrent writers can append instants out of
 * order). A release or drop acts on the one row the fold showed, the LATEST park under its id, so it spends that park
 * alone: an earlier one a collision buried stays owed.
 */
function approvedParksUnspent({
  lines,
  skipped,
}: {
  lines: readonly string[];
  skipped: ReadonlyMap<number, SkippedSlackDraftLine>;
}): readonly UnreadApprovedRow[] {
  const walk: Walk = { parks: new Map(), unsure: new Set() };
  for (const [index, text] of lines.entries()) {
    walkLine({ unread: skipped.get(index + 1), value: jsonRecord({ text }), walk });
  }
  return [...walk.parks.values()].flat().flatMap((park) => park.owed);
}

/** The walk's state: every park stacked under its id, and the ids whose latest park no release may spend. */
interface Walk {
  readonly parks: Map<string, Park[]>;
  readonly unsure: Set<string>;
}

/**
 * Apply one line. A park stacks, readable or not, and starts a fresh current row. A line this build cannot read that is
 * NOT a park — JSON or not — leaves the current row of the id it names unknown, so no release or drop spends that row
 * until a new park replaces it. Naming no id, or not JSON, it touches every row.
 */
function walkLine({
  unread,
  value,
  walk,
}: {
  unread: SkippedSlackDraftLine | undefined;
  value: Record<string, unknown> | undefined;
  walk: Walk;
}): void {
  const park = value === undefined ? undefined : parkOf({ value });
  if (park !== undefined) {
    stack({ park, parks: walk.parks });
    walk.unsure.delete(park.id);
    return;
  }
  if (unread !== undefined) {
    // An id recovered from a line that is not JSON is a text match, never a field, so such a line touches every row.
    const namesNoTrustedId = unread.id === undefined || value === undefined;
    const touched = namesNoTrustedId ? [...walk.parks.keys()] : [unread.id];
    touched.forEach((id) => walk.unsure.add(id));
    return;
  }
  const id = value?.["id"];
  const kind = value?.["kind"];
  if (typeof id === "string" && (kind === "released" || kind === "dropped") && !walk.unsure.has(id)) {
    spendLatest({ id, parks: walk.parks });
  }
}

/**
 * Spend the latest park under an id IN PLACE, exactly as the fold resolves only its current row: a second release or
 * drop lands on that same spent park and never reaches an earlier one.
 */
function spendLatest({ id, parks }: { id: string; parks: Map<string, Park[]> }): void {
  const stacked = parks.get(id);
  if (stacked === undefined || stacked.length === 0) {
    return;
  }
  stacked[stacked.length - 1] = { id, owed: [] };
}

/** One `parked` line under its id: the approved row it owes, or nothing when it carries no approval. */
interface Park {
  readonly id: string;
  readonly owed: readonly UnreadApprovedRow[];
}

/** Stack one park on its id's, above any earlier one a release has not yet spent. */
function stack({ park, parks }: { park: Park; parks: Map<string, Park[]> }): void {
  const earlier = parks.get(park.id);
  if (earlier === undefined) {
    parks.set(park.id, [park]);
    return;
  }
  earlier.push(park);
}

/** One register line as a JSON record, or nothing when it is not one. */
function jsonRecord({ text }: { text: string }): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (isRecord(value)) {
      return value;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * One register line read only as far as the gate needs: a `parked` event by its id, owing its id and instant when its
 * draft carries an `approval` key. Nothing else on it is trusted — the line may have failed this build's validation.
 */
function parkOf({ value }: { value: Record<string, unknown> }): Park | undefined {
  if (value["kind"] !== "parked" || typeof value["id"] !== "string") {
    return undefined;
  }
  const { draft, id, tsIso } = value;
  if (!isRecord(draft) || draft["approval"] === undefined) {
    return { id, owed: [] };
  }
  if (typeof tsIso !== "string") {
    return { id, owed: [{ id, tsIso: undefined }] };
  }
  return { id, owed: [{ id, tsIso }] };
}

/**
 * One owed draft as the refusal names it: its id, when it was recorded, the anchor of the owner's yes and the start of the owner's
 * words — or the word of the owner's it carries without a yes — then the one command that sends it.
 *
 * @param item the held row the gate owes
 * @returns two indented lines
 */
function namedDraft({ item, unsure }: { item: SlackDraftItem; unsure: boolean }): readonly string[] {
  const head = `  ${item.id} recorded ${item.draft.tsIso}, ${ownerWordOn({ item })}`;
  if (unsure) {
    return [head, STATE_UNKNOWN];
  }
  return [head, `    ${draftReleaseCommand({ item })}`];
}

/** The word of the owner's an owed row carries: the owner's yes at its anchor, else the change of meaning or yes a hold set down. */
function ownerWordOn({ item }: { item: SlackDraftItem }): string {
  const { approval, meaningChanged } = item.draft;
  if (approval !== undefined) {
    return `approved at ${approval.anchor} "${approval.heard.trim().slice(0, HEARD_CHARS)}"`;
  }
  if (meaningChanged !== undefined) {
    return `its meaning changed, waiting on the owner's word: "${meaningChanged.trim().slice(0, HEARD_CHARS)}"`;
  }
  return "a hold set the owner's yes down, and the Queue card cannot show why";
}

/** The line naming an owed row the fold does not show: its id, and its instant when the line carries one. */
function unreadApprovedHead({ row }: { row: UnreadApprovedRow }): string {
  if (row.tsIso === undefined) {
    return `  ${row.id}, approved on a register line the fold does not show held, which carries no instant`;
  }
  return `  ${row.id} recorded ${row.tsIso}, approved on a register line the fold does not show held`;
}

/** What an owed row the fold does not show says: why no verb reaches it, and the two routes through. */
const UNSHOWN_ROUTE =
  "    STATE UNKNOWN: the line is unreadable on this build, a later park reused its id, or an unreadable line left " +
  "which park a release spent unknown, so no verb here can " +
  "release or drop it. Rebuild this seat on current main (`slopweaver dev build`); if it still shows, the register " +
  "was written outside the verbs: say so in the owner's bot DM and open the hatch.";

/**
 * The approved-draft gate over one tick, judged against the tick's own start: its refusal block, or nothing when the
 * hatch is open or the register owes no send.
 *
 * @param hatchIsOpen whether the `approved-draft-held` hatch is open
 * @param read the draft register, as the shell read it once
 * @param startedIso when this tick started — a row recorded after it is the next tick's
 * @returns the refusal lines, or undefined when the tick may be recorded
 */
export function approvedDraftRefusal({
  hatchIsOpen,
  read,
  startedIso,
}: {
  hatchIsOpen: boolean;
  read: ApprovedDraftRead;
  startedIso: string;
}): readonly string[] | undefined {
  if (hatchIsOpen) {
    return undefined;
  }
  const verdict = judgeApprovedDrafts({ read, startedIso });
  if (verdict.kind === "clean") {
    return undefined;
  }
  // An unreadable read renders no landing, so it has no answers to carry.
  const answers = read.kind === "read" ? read.answers : new Map<string, AnswerContext>();
  return approvedDraftRefusalLines({ answers, verdict });
}

/**
 * Render the approved-draft gate's refusal: every approved row this tick owes a send, and the ways through.
 *
 * @param answers what each landing's words answered, keyed by landing anchor, as the read carried it
 * @param verdict the refused or unreadable verdict
 * @returns the hatch's four lines, two lines per owed draft, each landing with what it answered, the residue when any,
 *   and the ways out
 */
export function approvedDraftRefusalLines({
  answers,
  verdict,
}: {
  answers: ReadonlyMap<string, AnswerContext>;
  verdict: Exclude<ApprovedDraftVerdict, { kind: "clean" }>;
}): readonly string[] {
  const hatch = hatchFor({ id: "approved-draft-held" });
  if (verdict.kind === "unreadable") {
    return [
      ...hatchRefusalLines({ detail: `the Slack draft register could not be judged — ${verdict.why}`, hatch }),
      "Fix what that names and re-run this. It refuses rather than passing, because a check that reports clean on an " +
        "input it never saw is worse than no check.",
    ];
  }
  const skipped =
    verdict.skippedLines > 0
      ? [
          `${String(verdict.skippedLines)} line(s) of the draft register did not read with this build: one that is ` +
            "not JSON at all is unseen by this gate, never proof none is owed.",
        ]
      : [];
  const hidden = verdict.drafts.filter((item) => item.hold !== undefined || item.draft.approval === undefined).length;
  const approved = verdict.drafts.length - hidden + verdict.unreadApproved.length;
  const landed = verdict.landings.length + verdict.unreadableLandings.length;
  return [
    ...hatchRefusalLines({ detail: refusalDetail({ approved, hidden, landed }), hatch }),
    ...verdict.drafts.flatMap((item) => namedDraft({ item, unsure: verdict.unsureIds.includes(item.id) })),
    ...verdict.unreadApproved.flatMap((row) => [unreadApprovedHead({ row }), UNSHOWN_ROUTE]),
    ...(approved > 0 ? [APPROVED_ROUTE] : []),
    ...verdict.landings.flatMap((bound) =>
      landedDraft({
        answer: answers.get(bound.landing.anchor),
        bound,
        unsure: verdict.unsureIds.includes(bound.item.id),
      }),
    ),
    ...verdict.unreadableLandings.flatMap((one) => [
      ...landingHead({ answer: answers.get(one.landing.anchor), landing: one.landing }),
      `    UNREADABLE: ${one.why}`,
    ]),
    ...(landed > 0 ? [LANDED_ROUTE] : []),
    ...skipped,
    "Re-run this.",
  ];
}

/** The refusal's one-line reason: what this tick owes, in each kind it can owe. */
function refusalDetail({ approved, hidden, landed }: { approved: number; hidden: number; landed: number }): string {
  const parts: string[] = [];
  if (approved > 0) {
    parts.push(
      `${String(approved)} held Slack draft(s), recorded before this tick started, already carry the owner's approval and are ` +
        "unsent with no hold saying why — the owner's yes on a call is the send, never a reason to ask again",
    );
  }
  if (hidden > 0) {
    parts.push(
      `${String(hidden)} held Slack draft(s) carrying the owner's word are named by a register line this build cannot read, ` +
        "so the Queue hides them and their reason",
    );
  }
  if (landed > 0) {
    parts.push(
      `the owner's words landed on ${String(landed)} card(s) naming a Slack draft and no session has judged them — ` +
        "a yes nobody records is a send nobody makes",
    );
  }
  return parts.join("; ");
}

/** What an approved row owes: the send, or a hold naming why not. */
const APPROVED_ROUTE =
  "For EACH approved row: the owner's yes is settled, never re-read as not one (`hold --reason not-owner-yes` is refused on " +
  "it until a newer word from the owner lands on its card), so release it with the command shown. A mechanical fix first (em-dash, drip split, wrong tag, lowercase, a clickable link) is yours without asking: re-cut with " +
  "`slopweaver slack draft record --supersedes <id>` and the approval carries. Only a change of meaning earns the owner's " +
  'word again: re-cut with `--supersedes <id> --meaning-changed "<what>"`. A send blocked on something real is a ' +
  "hold the Queue card shows the owner: `slopweaver slack draft hold <id> --reason <thread-moved|no-fleet-slot|" +
  'slack-refused> --why "<what blocks it>"`.';
