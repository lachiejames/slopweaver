/**
 * The pull-request surface of the "Nothing stale" section: each row of the stored landing read placed in
 * exactly one of moving, waiting on a named person, needs the owner's word, or stale — or named as unseen.
 *
 * ## The one rule that must survive every later edit: MOVING needs a receipt, never a verdict
 *
 * The landing packet is written before any session acts, so a dispatch verdict names an act; it never says
 * anybody took it. A row reads moving only on a receipt this section can check: the read's own `presses[]`
 * carrying `outcome: "pressed"`, GitHub's merge queue holding it, its stack's bottom carrying the act (the
 * read's `stacked` action), or a run that is OPEN right now in the journal of its landing registration
 * (`registrationSlug`, `../review/boardAtHead.ts`) or of the board row declaring its branch. A named act with no
 * open run is KNOWN STALE. MEASURED: 55 of the 75 rows carried an act and not one had a run open —
 * `jq -c '[.rows[] | select(.dispatch.kind == "act") | (.boardRow.run // "none")] | group_by(.) | map({(.[0]): length}) | add' github-landing.json`
 * printed `{"finished":40,"never-started":11,"none":3,"orphaned":1}`.
 *
 * A queue, stack or press receipt is what the landing read SAW, and GitHub can eject, merge or close the pull
 * request a minute later. The read stores no instant for when it saw each one, only when the document was
 * published, so a line names the read by its publication rather than claiming a time GitHub was observed at,
 * and never claims it moves now.
 *
 * ## An open pull request the rows did not place is a hole, never an absence
 *
 * GitHub's own open list, carried beside the rows, names every pull request of the owner's the rows did not place as
 * unseen, and ends a row it no longer lists. That reconciliation, and why each rule stands, is
 * `./nothingStaleCensus.ts`.
 *
 * ## The owner's word outranks every receipt
 *
 * A run holding a question for the owner, or the read's own verdict reserving the row for the owner's judgement
 * (`OWNER_JUDGEMENT_VERDICT`), puts the row on the owner's word
 * whatever else carries it: a queued, stacked, pressed or open-run row would otherwise hide that question in the
 * moving lane.
 *
 * ## A person is a STRUCTURED identity, never a name found in prose
 *
 * `blockedOn` spells a person `@login` and a team `@org/team`, so a person is an entry with no `/` in it; the
 * newest ask's recipients are Slack ids, and one counts only when the read's own `people` roster names it. A
 * wait with neither is a wait on nobody — known stale.
 *
 * ## What is NOT a gap
 *
 * Every landing row and every landing read carries `residue` — MEASURED over the live readings
 * (`jq '[.rows[] | select(.residue | length > 0)] | length' ~/.slopweaver/readings/github-landing/<newest>.json`):
 * 28 of 28 rows, and seven document lines. Those are the read's standing bounds, so they are caveats; a row
 * whose dispatch is `unread`, or whose receipt journal could not be read, is a real hole, and that is what
 * names pull requests as unseen.
 *
 * Pure. Reports only: nothing here presses, closes or sends.
 */
import type { BriefingContent } from "../outbound/briefing/types.js";
import { registrationSlug } from "../review/boardAtHead.js";
import { censusHoles, draftsBound, endedIdentities, matchKey } from "./nothingStaleCensus.js";
import { linkRuns } from "./nothingStaleLink.js";
import type { LandingBriefingDocument, LandingRowView, NothingStaleItem, RunReceipt } from "./nothingStaleTypes.js";

/** What the pull-request surface contributes: its items, the rows it could not classify, and its own bounds. */
export interface PullRequestSurface {
  readonly items: readonly NothingStaleItem[];
  readonly unseen: readonly string[];
  /** What the read's selection leaves out by design — a caveat, never a gap. */
  readonly bounds: readonly string[];
}

/** The one verdict the landing read reserves for the owner's judgement. */
export const OWNER_JUDGEMENT_VERDICT = "needs-owner-judgment" as const;

/**
 * The runs naming one pull request by its repository, number and title — a link when its stored address parses.
 *
 * @param repoSlug `owner/name`
 * @param number the pull request's number
 * @param title its own title, when known
 * @param url where it lives
 * @returns the link run, or the name and the address as text
 */
function prLink({
  repoSlug,
  number,
  title,
  url,
}: {
  readonly repoSlug: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
}): BriefingContent {
  const named = title.length === 0 ? "" : ` ${title}`;
  return linkRuns({ text: `${repoSlug}#${String(number)}${named}`, url });
}

/** A pull request's stable identity. */
function identityOf({ repoSlug, number }: { readonly repoSlug: string; readonly number: number }): string {
  return `pull-request:${repoSlug}#${String(number)}`;
}

/**
 * The people a waiting row is structurally waiting on: named code owners, then the newest ask's recipients
 * the roster names — each once, in that order.
 *
 * @param row the landing row
 * @param people the read's own roster of asked Slack ids
 * @returns every named person, empty when the wait names nobody
 */
function namedPeople({
  row,
  people,
}: {
  readonly row: LandingRowView;
  readonly people: Readonly<Record<string, string>>;
}): readonly string[] {
  const owners = row.blockedOn.filter((owner) => owner.startsWith("@") && !owner.includes("/"));
  const asked = row.latestAskRecipients.flatMap((id) => {
    const name = people[id];
    return name === undefined ? [] : [name];
  });
  return [...new Set([...owners, ...asked])];
}

/**
 * Every journal a row's receipt could live in: its landing registration at the head the read saw, then the
 * board row declaring its branch when that is a different one.
 *
 * @param row the landing row
 * @returns the slugs, each once
 */
export function receiptSlugs({ row }: { readonly row: LandingRowView }): readonly string[] {
  const own = registrationSlug({ row });
  if (row.boardRowSlug === undefined || row.boardRowSlug === own) {
    return [own];
  }
  return [own, row.boardRowSlug];
}

/**
 * What the run journals said about one row, strongest first. A question for the owner or an open run carries every
 * sibling journal that could not be read, because the row's lane stands either way and the line still names
 * what was not seen.
 */
type JournalReceipt =
  | { readonly kind: "asking"; readonly slug: string; readonly unread: readonly string[] }
  | { readonly kind: "open"; readonly slug: string; readonly unread: readonly string[] }
  | { readonly kind: "unreadable"; readonly reasons: readonly string[] }
  | { readonly kind: "none" };

/**
 * The strongest receipt any of a row's journals carries: a run holding a question for the owner, then an open run,
 * then an unreadable journal — which proves nothing either way — then none.
 *
 * An unreadable sibling never outranks a question or an open run: whatever it holds, the row is the owner's word or
 * moving, never stale, so it rides the line as an unread note instead of turning a decided row into a gap.
 *
 * @param row the landing row
 * @param runs every journal read, keyed by slug
 * @returns the receipt
 */
function journalReceipt({
  row,
  runs,
}: {
  readonly row: LandingRowView;
  readonly runs: ReadonlyMap<string, RunReceipt>;
}): JournalReceipt {
  const read = receiptSlugs({ row }).flatMap((slug) => {
    const receipt = runs.get(slug);
    return receipt === undefined ? [] : [{ receipt, slug }];
  });
  const reasons = read.flatMap(({ receipt, slug }) =>
    receipt.kind === "unreadable" ? [`its run journal \`${slug}\` could not be read: ${receipt.reason}`] : [],
  );
  const asking = read.find(({ receipt }) => receipt.kind === "phase" && receipt.phase === "waiting-on-owner");
  if (asking !== undefined) {
    return { kind: "asking", slug: asking.slug, unread: reasons };
  }
  const open = read.find(({ receipt }) => receipt.kind === "phase" && receipt.phase === "open");
  if (open !== undefined) {
    return { kind: "open", slug: open.slug, unread: reasons };
  }
  if (reasons.length > 0) {
    return { kind: "unreadable", reasons };
  }
  return { kind: "none" };
}

/** One row's classification: an item, or the reasons it is a hole. */
type RowVerdict = { readonly item: NothingStaleItem } | { readonly unseen: readonly string[] };

/**
 * One row's item, built from its link and the text after it.
 *
 * @param row the landing row
 * @param lane where it lands
 * @param text everything after the link
 * @returns the verdict carrying the item
 */
function itemOf({
  row,
  lane,
  text,
}: {
  readonly row: LandingRowView;
  readonly lane: NothingStaleItem["lane"];
  readonly text: string;
}): RowVerdict {
  return {
    item: { identity: identityOf(row), lane, line: [...prLink(row), { kind: "text", text }], surface: "pull-requests" },
  };
}

/**
 * Whether the landing read reserved this row for the owner's judgement — which, like a question in a journal, outranks
 * every receipt: the producer decides it before queue or stack, and names a queued pull request with an
 * unwithdrawn objection its most urgent card (`../review/landingDispatch.ts`).
 *
 * @param row the landing row
 * @returns `true` when the row's verdict is the owner's
 */
function isOwnerJudgement({ row }: { readonly row: LandingRowView }): boolean {
  return row.dispatch.kind === "act" && row.dispatch.verdict === OWNER_JUDGEMENT_VERDICT;
}

/** The text after a row's link when the read reserved it for the owner's judgement. */
function judgementText({ why, unread }: { readonly why: string; readonly unread: string }): string {
  return ` — reply \`decide\`: ${why}${unread}`;
}

/**
 * The receipt-free part of a row's verdict once the owner's judgement is ruled out: a named wait, or stale.
 *
 * @param row the landing row
 * @param people the read's roster
 * @returns the verdict
 */
function withoutReceipt({
  row,
  people,
}: {
  readonly row: LandingRowView;
  readonly people: Readonly<Record<string, string>>;
}): RowVerdict {
  const dispatch = row.dispatch;
  if (dispatch.kind === "act") {
    const slug = registrationSlug({ row });
    return itemOf({
      lane: "stale",
      row,
      text: ` — ${dispatch.verdict} named, and no open run holds it (\`${slug}\`): ${dispatch.why}`,
    });
  }
  const named = namedPeople({ people, row });
  if (named.length > 0) {
    return itemOf({ lane: "waiting", row, text: ` — waiting on ${named.join(", ")}: ${dispatch.why}` });
  }
  return itemOf({ lane: "stale", row, text: ` — ${dispatch.kind}, on nobody named: ${dispatch.why}` });
}

/** The sentence naming every journal a decided row could not read, empty when none. */
function unreadNote({ unread }: { readonly unread: readonly string[] }): string {
  if (unread.length === 0) {
    return "";
  }
  return ` Not seen: ${unread.join("; ")}.`;
}

/**
 * Every journal a receipt could not read, for a row another receipt already decides.
 *
 * @param receipt what the row's journals said
 * @returns the reasons, empty when every journal read
 */
function unreadOf({ receipt }: { readonly receipt: JournalReceipt }): readonly string[] {
  if (receipt.kind === "unreadable") {
    return receipt.reasons;
  }
  if (receipt.kind === "none") {
    return [];
  }
  return receipt.unread;
}

/** The text after a row's link when a run holds a question for the owner, after whatever receipt also carries it. */
function askingText({
  receipt,
  why,
}: {
  readonly receipt: Extract<JournalReceipt, { kind: "asking" }>;
  readonly why: string;
}): string {
  const unread = unreadNote({ unread: receipt.unread });
  return ` — run \`${receipt.slug}\` holds a question for you on the Queue. ${why}${unread}`;
}

/**
 * One row's verdict.
 *
 * @param row the landing row
 * @param people the read's roster
 * @param runs every journal read, keyed by slug
 * @param publishedIso when the landing read was published, which names the read a queue or stack receipt is from
 * @returns the item, or the reasons it is a hole
 */
function rowVerdict({
  row,
  people,
  runs,
  publishedIso,
}: {
  readonly row: LandingRowView;
  readonly people: Readonly<Record<string, string>>;
  readonly runs: ReadonlyMap<string, RunReceipt>;
  readonly publishedIso: string;
}): RowVerdict {
  const dispatch = row.dispatch;
  const receipt = journalReceipt({ row, runs });
  if (receipt.kind === "asking") {
    return itemOf({ lane: "needs-word", row, text: askingText({ receipt, why: dispatch.why }) });
  }
  if (dispatch.kind === "unread") {
    return { unseen: [`${row.repoSlug}#${String(row.number)} could not be decided: ${dispatch.why}`] };
  }
  const unread = unreadNote({ unread: unreadOf({ receipt }) });
  if (isOwnerJudgement({ row })) {
    return itemOf({ lane: "needs-word", row, text: judgementText({ unread, why: dispatch.why }) });
  }
  if (row.queueKind === "queued" || row.action === "queued") {
    const text = ` — GitHub's merge queue held it ${seenIn({ publishedIso })}. ${dispatch.why}${unread}`;
    return itemOf({ lane: "moving", row, text });
  }
  if (row.action === "stacked") {
    const text = ` — the bottom of its stack carried the act ${seenIn({ publishedIso })}. ${dispatch.why}${unread}`;
    return itemOf({ lane: "moving", row, text });
  }
  if (receipt.kind === "open") {
    return itemOf({ lane: "moving", row, text: ` — run \`${receipt.slug}\` is open. ${dispatch.why}${unread}` });
  }
  if (receipt.kind === "unreadable") {
    return { unseen: receipt.reasons.map((reason) => `${row.repoSlug}#${String(row.number)}: ${reason}`) };
  }
  return withoutReceipt({ people, row });
}

/**
 * The words naming the landing read a receipt came from, by the one instant it stores: its publication.
 *
 * @param publishedIso when the landing read was published
 * @returns the phrase
 */
function seenIn({ publishedIso }: { readonly publishedIso: string }): string {
  return `in the landing read published ${publishedIso}`;
}

/**
 * One press's item: moving on the press's own receipt in the read, unless a journal of the row it pressed
 * holds a question for the owner or the read reserved that row for the owner's judgement, either of which puts it on the owner's word.
 *
 * @param press the pressed entry
 * @param document the landing read, whose row for the press carries its title and journals
 * @param runs every journal read, keyed by slug
 * @param publishedIso when the landing read was published
 * @returns the item
 */
function pressedItem({
  press,
  document,
  runs,
  publishedIso,
}: {
  readonly press: LandingBriefingDocument["presses"][number];
  readonly document: LandingBriefingDocument;
  readonly runs: ReadonlyMap<string, RunReceipt>;
  readonly publishedIso: string;
}): NothingStaleItem {
  const row = document.rows.find((candidate) => identityOf(candidate) === identityOf(press));
  const link = prLink({ ...press, title: row === undefined ? "" : row.title });
  const item = { identity: identityOf(press), surface: "pull-requests" } as const;
  if (row === undefined) {
    const text = ` — pressed into the merge queue ${seenIn({ publishedIso })}. ${press.detail}`;
    return { ...item, lane: "moving", line: [...link, { kind: "text", text }] };
  }
  const receipt = journalReceipt({ row, runs });
  if (receipt.kind === "asking") {
    return {
      ...item,
      lane: "needs-word",
      line: [...link, { kind: "text", text: askingText({ receipt, why: press.detail }) }],
    };
  }
  const unread = unreadNote({ unread: unreadOf({ receipt }) });
  if (isOwnerJudgement({ row })) {
    const why = row.dispatch.why;
    return { ...item, lane: "needs-word", line: [...link, { kind: "text", text: judgementText({ unread, why }) }] };
  }
  const text = ` — pressed into the merge queue ${seenIn({ publishedIso })}. ${press.detail}${unread}`;
  return { ...item, lane: "moving", line: [...link, { kind: "text", text }] };
}

/**
 * Classify every pull request the stored landing read carries, and name every one GitHub lists that it does not.
 *
 * A pressed pull request is reported once, on the press's own receipt, and never again as its own row.
 *
 * @param document the validated landing read
 * @param publishedIso when the landing read was published, which names the read every receipt is from
 * @param runs every receipt journal read, keyed by slug
 * @returns the items in the read's own order, pressed ones first, every hole, and the selection's bounds
 */
export function pullRequestSurface({
  document,
  publishedIso,
  runs,
}: {
  readonly document: LandingBriefingDocument;
  readonly publishedIso: string;
  readonly runs: ReadonlyMap<string, RunReceipt>;
}): PullRequestSurface {
  const ended = endedIdentities({ document });
  const pressed = document.presses.filter((press) => press.outcome === "pressed");
  const pressedIds = new Set(pressed.map((press) => matchKey(press)));
  const pressedItems = pressed
    .filter((press) => !ended.has(matchKey(press)))
    .map((press) => pressedItem({ document, press, publishedIso, runs }));
  const verdicts = document.rows
    .filter((row) => !pressedIds.has(matchKey(row)) && !ended.has(matchKey(row)))
    .map((row) => rowVerdict({ people: document.people, publishedIso, row, runs }));
  const drafts = document.selection.includeDrafts ? [] : [draftsBound({ document })];
  const endedLines = [...document.rows, ...pressed]
    .filter((entry) => ended.has(matchKey(entry)))
    .filter((entry, index, entries) => entries.findIndex((other) => matchKey(other) === matchKey(entry)) === index)
    .map((entry) => `${entry.repoSlug}#${String(entry.number)}`)
    .map((name) => `${name} was not on GitHub's open list in the same read, so it closed or merged and is not counted`);
  return {
    bounds: [...drafts, ...endedLines],
    items: [...pressedItems, ...verdicts.flatMap((verdict) => ("item" in verdict ? [verdict.item] : []))],
    unseen: [
      ...verdicts.flatMap((verdict) => ("unseen" in verdict ? verdict.unseen : [])),
      ...censusHoles({ document }),
    ],
  };
}
