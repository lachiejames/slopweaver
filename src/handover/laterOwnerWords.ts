/**
 * The gate `handover ask` meets when the owner has said more since the words its row was registered from: the ready,
 * open `talk-*` rows registered after the row's own `hisWordsIso`, which this seat has not been shown.
 *
 * ## The defect it closes
 *
 * A seat on one talk row asked the owner to take a page's leans as one set, three days after the owner had already
 * said "take the set" on ANOTHER ready talk row registered hours after this row's own words — a row that seat never
 * read. `./ruledReaskGate.ts` cannot see that: it matches a ruling in the SAME run's journal under the SAME question
 * words. Find such a pair on any board: compare each ready `talk-*` row's `askedIso:` front matter
 * (`grep -H '^askedIso:' $SLOPWEAVER_HOME/handovers/talk-*.md`) with the asking row's `ownerWordsIso:`.
 *
 * ## What it asks, and what it cannot
 *
 * A seat cannot be watched reading, so the record of having read them is the seat naming every listed slug in
 * `--read-owner-words <slug,...>`: a list that must cover what is listed NOW, never a blanket switch. A row whose own
 * words are not held (absent, unread or a defect) has no instant to measure from, so it is never refused here — stated
 * residue, not an oversight. An `askedIso` that does not parse cannot be ordered either way, so that row stays listed,
 * the direction `./heldQuestion.ts` takes with an uncertain card. A `talk-*` file the scan could not read refuses
 * too, since it may be exactly the words this gate exists to show, until the seat names its slug (the file name less
 * `.md`) as read by hand: one corrupt file would otherwise hold every ask on the board.
 *
 * Pure: the caller supplies the rows, the scan's unreadable names and what the seat says it read.
 */

import { parseStrictIsoInstantMs } from "#lib/date.js";
import { fitOnOneLine } from "#lib/oneLineSummary.js";

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { isOpenAsk } from "./askRow.js";
import type { HandoverDoc } from "./doc.js";

/** The slug prefix every row the console's words land on carries: a relay's `talk-<12 hex>`, a card's `talk-card-…`. */
export const TALK_ROW_PREFIX = "talk-";

/** The flag a seat names every listed row in, once it has read each. */
export const READ_OWNER_WORDS_FLAG = "read-owner-words";

/** How much of one row's words the refusal quotes, so a long relay stays one line. */
const EXCERPT_CHARS = 140;

/** What `handover ask` should do with the question it was handed. */
export type LaterOwnerWordsVerdict =
  | { readonly kind: "ok" }
  /** Not recordable. `lines` is whole — the caller prints it and adds nothing. */
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/** A row's registration instant, or `undefined` when it is absent or does not parse. */
function registeredMs({ doc }: { doc: HandoverDoc }): number | undefined {
  if (doc.askedIso === undefined) {
    return undefined;
  }
  return parseStrictIsoInstantMs({ text: doc.askedIso });
}

/** Ascending registration order, uncertain instants after every certain one, raw text then slug breaking a tie. */
function compareRegistration({ a, b }: { a: HandoverDoc; b: HandoverDoc }): number {
  const left = registeredMs({ doc: a });
  const right = registeredMs({ doc: b });
  if (left !== undefined && right !== undefined && left !== right) {
    return left - right;
  }
  if (left === undefined && right !== undefined) {
    return 1;
  }
  if (left !== undefined && right === undefined) {
    return -1;
  }
  const leftRaw = `${String(a.askedIso)}\u0000${a.slug}`;
  const rightRaw = `${String(b.askedIso)}\u0000${b.slug}`;
  if (leftRaw === rightRaw) {
    return 0;
  }
  return leftRaw < rightRaw ? -1 : 1;
}

/**
 * Whether one row is the owner's words registered after `sinceMs`. Either instant failing to parse keeps the row:
 * it cannot be shown to be older.
 */
function isLaterOwnerWordRow({ doc, sinceMs }: { doc: HandoverDoc; sinceMs: number | undefined }): boolean {
  if (!doc.slug.startsWith(TALK_ROW_PREFIX) || doc.status !== "ready" || !isOpenAsk({ doc })) {
    return false;
  }
  const ms = registeredMs({ doc });
  return ms === undefined || sinceMs === undefined || ms > sinceMs;
}

/**
 * The rows holding the owner's words registered after an instant: ready, open `talk-*` asks other than the asking
 * row, whose `askedIso` is strictly later or cannot be parsed, in registration order.
 *
 * @param rows every row the board holds
 * @param sinceIso the instant the asking row's own words were recorded at
 * @param selfSlug the asking row, never listed against itself
 * @returns the rows, ascending by registration, each slug once
 */
export function laterOwnerWordRows({
  rows,
  sinceIso,
  selfSlug,
}: {
  rows: readonly HandoverDoc[];
  sinceIso: string;
  selfSlug: string;
}): readonly HandoverDoc[] {
  const sinceMs = parseStrictIsoInstantMs({ text: sinceIso });
  const seen = new Set<string>();
  return rows
    .filter((doc) => doc.slug !== selfSlug && isLaterOwnerWordRow({ doc, sinceMs }))
    .toSorted((a, b) => compareRegistration({ a, b }))
    .filter((doc) => {
      if (seen.has(doc.slug)) {
        return false;
      }
      seen.add(doc.slug);
      return true;
    });
}

/** One listed row as the refusal prints it: its slug, when it was registered, and what the owner said there. */
function rowLine({ doc }: { doc: HandoverDoc }): string {
  const when = doc.askedIso === undefined ? "no registration instant" : `registered ${doc.askedIso}`;
  const group = doc.hisWords;
  if (group.kind === "held") {
    return `  - ${doc.slug} (${when}): "${fitOnOneLine({ maxChars: EXCERPT_CHARS, text: group.hisWords.words })}"`;
  }
  if (group.kind === "unread") {
    return `  - ${doc.slug} (${when}): its stored words could not be read (${group.why}) — read ${doc.path}`;
  }
  if (group.kind === "defect") {
    return `  - ${doc.slug} (${when}): its stored words are a defect (${group.why}) — read ${doc.path}`;
  }
  return `  - ${doc.slug} (${when}): no words stored on the row — read ${doc.path}`;
}

/**
 * The verdict on a question about to be asked on `doc`'s run, given the board it was judged against.
 *
 * @param doc the asking row, as the verb resolved or re-read it
 * @param rows every row the board scan read
 * @param unreadable the file names the scan could not read — a `talk-*` one makes the list unprovable
 * @param read the slugs the seat named in `--read-owner-words`, having read each
 * @param command the door being refused, as the owner would type it
 * @returns `ok`, or the whole refusal to print
 */
export function laterOwnerWordsVerdict({
  command,
  doc,
  read,
  rows,
  unreadable,
}: {
  command: string;
  doc: HandoverDoc;
  read: readonly string[];
  rows: readonly HandoverDoc[];
  unreadable: readonly string[];
}): LaterOwnerWordsVerdict {
  if (doc.hisWords.kind !== "held") {
    return { kind: "ok" };
  }
  const sinceIso = doc.hisWords.hisWords.atIso;
  const hatch = { ...hatchFor({ id: "later-owner-words" }), command };
  const named = new Set(read);
  const lost = unreadable
    .filter((name) => name.startsWith(TALK_ROW_PREFIX))
    .filter((name) => !named.has(name.replace(/\.md$/u, "")));
  if (lost.length > 0) {
    return {
      kind: "refused",
      lines: [
        hatchRefusal({ detail: "the board scan could not read every row the owner's words land on", hatch }),
        ...lost.map((name) => `  - unreadable: ${name}`),
        "NOTHING was recorded. Repair or remove each file named, then ask again — or, having read one by hand and " +
          `found nothing that answers the question, name its slug in --${READ_OWNER_WORDS_FLAG}.`,
      ],
    };
  }
  const unseen = laterOwnerWordRows({ rows, selfSlug: doc.slug, sinceIso }).filter((row) => !named.has(row.slug));
  if (unseen.length === 0) {
    return { kind: "ok" };
  }
  return {
    kind: "refused",
    lines: [
      hatchRefusal({
        detail: `${unseen.length} ready row(s) hold words the owner said after ${sinceIso}, this row's own`,
        hatch,
      }),
      ...unseen.map((row) => rowLine({ doc: row })),
      "NOTHING was recorded and the run is not paused. Read each row in full (`slopweaver handover row --slug " +
        "<slug> --json`); if one answers the question, act on it instead of asking. Otherwise ask again with " +
        `--${READ_OWNER_WORDS_FLAG} ${unseen.map((row) => row.slug).join(",")}`,
    ],
  };
}
