/**
 * The corpus leg: stream the local Slack bronze and keep every record that reaches a pull request.
 *
 * This is the effectful shell over `./prLink.ts`'s pure matchers and `./slackEvidenceRecord.ts`'s readers. It
 * decides nothing about what a message MEANS — it decides which lines are worth parsing, and which copy of an
 * edited message speaks for it now.
 *
 * ## Why the scan streams and pre-filters
 *
 * A Slack bronze window file has no size ceiling — the epoch backfill's single window passed 3.5 GB, seven
 * times the longest string V8 will make — so it is read line by line and never as one string. Each line is
 * substring-tested before it is parsed, because a window holds hundreds of thousands of records and a handful
 * can match: measured on the owner's own 6.3 GB corpus, the whole scan costs about 1.3 seconds.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { parseRow } from "../corpus/corpusRowCore.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import type { CorpusRecord } from "../corpus/types.js";
import { appendAll } from "../lib/arrays.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import { type ReviewError, ReviewErrors } from "./errors.js";
import { authoredTextOf, findPrLinks, type PrLinkRef, slackHaystack } from "./prLink.js";
import { inheritedPairs, rootPrKeysByThread, type ThreadMember, threadKeyOfSourceId } from "./reviewConversation.js";
import {
  marksOwnerOnlyConversation,
  mentionOf,
  mentionsFromRecord,
  type RecordContext,
  threadMemberOf,
} from "./slackEvidenceRecord.js";
import { messageKeyOfSourceId, prKeyOf, type SlackIdentity, type SlackMention } from "./slackEvidenceTypes.js";

/** The cheap per-line pre-filter: a line worth parsing names one of the repositories in a link path. */
function lineCouldMatch({ line, paths }: { line: string; paths: readonly string[] }): boolean {
  return paths.some((path) => line.includes(path));
}

/**
 * The link-path fragments a pre-filter tests for, one `owner/repo/pull` and `owner/repo/issues` per repo.
 *
 * @param refs the pull requests being looked for
 * @returns the deduped path fragments, cheap enough to test against every raw line
 */
export function linkPathFragments({ refs }: { refs: readonly PrLinkRef[] }): readonly string[] {
  const fragments = new Set<string>();
  for (const ref of refs) {
    fragments.add(`${ref.owner}/${ref.repo}/pull/`);
    fragments.add(`${ref.owner}/${ref.repo}/issues/`);
  }
  return [...fragments];
}

/**
 * Every corpus message that links one of these pull requests.
 *
 * TWO passes over the matched records, not one, and the reason is a rule rather than an optimisation: a
 * conversation is established as the owner's own with the owner's bot by ANY record in it
 * ({@link marksOwnerOnlyConversation}), and the record that establishes it can arrive after the ones it
 * governs. A single pass would exclude the owner's bot DM's later messages and admit its earlier ones, which is a
 * boundary decided by file order. Both passes are over the same small matched set, never over the corpus.
 *
 * @param home the Slopweaver home whose Slack bronze is scanned
 * @param refs the pull requests to look for
 * @param identity who the owner is and which ids are the owner's own bot
 * @returns one mention per (message, pull request) pair, in the order the files deliver them, or why the
 *   bronze could not be listed — which must never read as "no message links it"
 */
export function scanCorpusMentions({
  home,
  refs,
  identity,
}: {
  home: string;
  refs: readonly PrLinkRef[];
  identity: SlackIdentity;
}): Result<readonly SlackMention[], ReviewError> {
  if (refs.length === 0) {
    return ok([]);
  }
  const dir = join(stateHomePaths({ home }).corpus.bronze, "slack");
  let names: readonly string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch (caught) {
    // An unlistable bronze used to answer an empty success, and the watermark then let that emptiness be
    // reported as "never asked". The scan found nothing because it READ nothing, which is a different fact.
    return err(ReviewErrors.slackBronzeUnlistable({ cause: caught, dir }));
  }
  const wanted = new Set(refs.map((ref) => prKeyOf({ ref })));
  const paths = linkPathFragments({ refs });
  const matched = streamRecords({ dir, keep: ({ line }) => linkingRecordOn({ line, paths }), names });
  // THE SECOND PASS reads every OTHER copy of a message the first pass found. The first pass keeps only lines
  // that still link a pull request, so a later copy that REMOVED the link — an edit, a hygiene redaction —
  // was never read, and the old linking text kept certifying. MEASURED: of 12,390 distinct
  // messages linking an acme-admin pull request, 2,276 have several copies and 3 disagree on their text.
  // The same pass reads every THREAD a wanted link sits in, because a reply rarely repeats the link it
  // answers: one of the owner's asks carries four replies in bronze and none of them links it. See
  // `./reviewConversation.ts` for the measurement and the association rules.
  const keys = new Set(matched.map((record) => messageKeyOfSourceId({ sourceId: record.sourceId })));
  const threads = new Set(
    matched
      .filter((record) =>
        findPrLinks({ haystack: slackHaystack({ record }) }).some((ref) => wanted.has(prKeyOf({ ref }))),
      )
      .map((record) => threadKeyOfSourceId({ sourceId: record.sourceId })),
  );
  const others = streamRecords({ dir, keep: ({ line }) => otherCopyOn({ keys, line, paths, threads }), names });
  const { current, disagreeing } = currentVersions({ records: [...matched, ...others] });
  const members = current.map((record) => threadMemberOf({ identity, record }));
  const copies = [...matched, ...others].map((record) => threadMemberOf({ identity, record }));
  const context: RecordContext = {
    disagreeing,
    identity,
    ownerOnlyContainers: new Set(
      matched.filter((record) => marksOwnerOnlyConversation({ identity, record })).map((record) => record.container),
    ),
    rootPrKeys: rootPrKeysByThread({ members }),
  };
  const found: SlackMention[] = [];
  for (const record of current) {
    appendAll({ from: mentionsFromRecord({ context, record, wanted }), into: found });
  }
  appendAll({ from: threadMentions({ context, copies, current, linked: found, members }), into: found });
  return ok(found);
}

/**
 * The replies that join a pull request's conversation by their thread alone, as `thread` mentions.
 *
 * A reply that already reaches the pull request as a LINKED mention — its link only in an unfurl, say — is
 * that mention and is never added twice.
 *
 * @param current the records that speak for their messages now, index-aligned with {@link members}
 * @param members the same records as association reads them
 * @param copies every copy read, superseded ones included, so an edit cannot hide what a message reaches
 * @param linked every linked mention already built
 * @param context the scan-wide facts that place a record
 * @returns one mention per reply and pull request it joins
 */
function threadMentions({
  current,
  members,
  copies,
  linked,
  context,
}: {
  current: readonly CorpusRecord[];
  members: readonly ThreadMember[];
  copies: readonly ThreadMember[];
  linked: readonly SlackMention[];
  context: RecordContext;
}): readonly SlackMention[] {
  const linkedThreads = new Map<string, Set<string>>();
  const already = new Set<string>();
  for (const mention of linked) {
    already.add(`${mention.prKey}|${mention.messageKey}`);
    const threadsOfPr = linkedThreads.get(mention.prKey);
    if (threadsOfPr === undefined) {
      linkedThreads.set(mention.prKey, new Set([mention.threadKey]));
    } else {
      threadsOfPr.add(mention.threadKey);
    }
  }
  const recordOf = new Map(current.map((record, index) => [members[index]!, record]));
  return inheritedPairs({ copies, linkedThreads, members })
    .map(({ member, prKey }) => mentionOf({ association: "thread", context, prKey, record: recordOf.get(member)! }))
    .filter((mention) => !already.has(`${mention.prKey}|${mention.messageKey}`));
}

/**
 * Stream every Slack bronze file in name order and keep the records a line-level test returns.
 *
 * @param dir the Slack bronze directory
 * @param names the file names in it
 * @param keep what to keep from one line, or undefined to skip it
 * @returns every kept record, in read order
 */
function streamRecords({
  dir,
  names,
  keep,
}: {
  dir: string;
  names: readonly string[];
  keep: (args: { line: string }) => CorpusRecord | undefined;
}): readonly CorpusRecord[] {
  const kept: CorpusRecord[] = [];
  for (const name of names.toSorted()) {
    readJsonlLines({
      onLine: ({ line }) => {
        const record = keep({ line });
        if (record !== undefined) {
          kept.push(record);
        }
      },
      path: join(dir, name),
    });
  }
  return kept;
}

/**
 * The Slack record on a line that links one of the wanted repositories, or undefined — the first pass.
 *
 * @param line one bronze line
 * @param paths the link-path fragments worth parsing a line for
 * @returns the parsed record, or undefined
 */
function linkingRecordOn({ line, paths }: { line: string; paths: readonly string[] }): CorpusRecord | undefined {
  if (line.length === 0 || !lineCouldMatch({ line, paths })) {
    return undefined;
  }
  const decoded = parseRow({ line });
  if (!("record" in decoded) || decoded.record.source !== "slack") {
    return undefined;
  }
  return decoded.record;
}

/** The literal a bronze line spells its source id with, which the second pass finds without parsing. */
const SOURCE_ID_FIELD = '"sourceId":"';

/**
 * A copy of a candidate message, or a message in a candidate THREAD, on a line the first pass did NOT keep.
 *
 * Only a line whose source id normalises to a candidate key or thread is parsed, so the second pass costs one
 * `indexOf` per line rather than one `JSON.parse`.
 *
 * @param line one bronze line
 * @param keys the message keys the first pass found
 * @param threads the threads in which the first pass found a wanted link
 * @param paths the link-path fragments the first pass kept lines by
 * @returns the parsed Slack record, or undefined when the line is not another copy of a candidate
 * @internal
 */
export function otherCopyOn({
  line,
  keys,
  threads,
  paths,
}: {
  line: string;
  keys: ReadonlySet<string>;
  threads: ReadonlySet<string>;
  paths: readonly string[];
}): CorpusRecord | undefined {
  if (line.length === 0 || lineCouldMatch({ line, paths })) {
    return undefined;
  }
  const at = line.indexOf(SOURCE_ID_FIELD);
  if (at === -1) {
    return undefined;
  }
  const start = at + SOURCE_ID_FIELD.length;
  const end = line.indexOf('"', start);
  if (end === -1) {
    return undefined;
  }
  const sourceId = line.slice(start, end);
  if (!keys.has(messageKeyOfSourceId({ sourceId })) && !threads.has(threadKeyOfSourceId({ sourceId }))) {
    return undefined;
  }
  const decoded = parseRow({ line });
  if (!("record" in decoded) || decoded.record.source !== "slack") {
    return undefined;
  }
  return decoded.record;
}

/**
 * The one copy that speaks for a message whose current copies agree: the last message copy, or a pin's words
 * under the last message copy's identity when only pins are current.
 *
 * @param copies every copy of the message
 * @param pool the copies that are current — the edited ones, or all when none is
 * @returns the record that speaks for the message
 */
function speakerOf({ copies, pool }: { copies: readonly CorpusRecord[]; pool: readonly CorpusRecord[] }): CorpusRecord {
  const current = pool.at(-1)!;
  const identity = copies.findLast((copy) => copy.kind !== "pin");
  const authored = pool.findLast((copy) => copy.kind !== "pin");
  if (authored !== undefined) {
    return authored;
  }
  const { raw } = current;
  if (identity === undefined || raw === undefined) {
    return current;
  }
  return { ...identity, raw, text: current.text };
}

/**
 * The copy of each message that speaks for it now, and which messages cannot be ordered.
 *
 * Every `message`, `comment` or `pin` copy is a VERSION, raw payload or not; a file or anything else passes
 * through untouched. A pin is its message as Slack returned it when the pins were fetched — older or newer than
 * the crawl's copy — so it is ordered like any other: passed through, a stale pin carried words an edit removed,
 * and dropped beside any copy, it hid an edit only the pin had read.
 * A pin lends only its WORDS: when it speaks, it does so under a message copy's identity where one was read,
 * since only that copy names its author as an id and its place in a thread. Among versions,
 * one Slack marked `edited` beats one it did not. Hygiene rewrites the edit's time, so two edited copies — or two
 * unedited ones — that still disagree on text have no order. EVERY such copy is kept and its key reported,
 * so each pull request any of them links reads `undecided`. Keeping only the last one read let a copy that
 * dropped the link erase the mention outright, which is "never asked" by file order. Found by a fallback review.
 *
 * @param records every copy both passes read, in read order
 * @returns the records that speak for their messages now, and the keys whose copies disagree unordered
 * @internal
 */
export function currentVersions({ records }: { records: readonly CorpusRecord[] }): {
  readonly current: readonly CorpusRecord[];
  readonly disagreeing: ReadonlySet<string>;
} {
  const passthrough: CorpusRecord[] = [];
  const versions = new Map<string, CorpusRecord[]>();
  for (const record of records) {
    if (record.kind !== "message" && record.kind !== "comment" && record.kind !== "pin") {
      passthrough.push(record);
      continue;
    }
    const key = messageKeyOfSourceId({ sourceId: record.sourceId });
    const list = versions.get(key);
    if (list === undefined) {
      versions.set(key, [record]);
    } else {
      list.push(record);
    }
  }
  const current = [...passthrough];
  const disagreeing = new Set<string>();
  for (const [key, copies] of versions) {
    const edited = copies.filter((copy) => isRecord(copy.raw) && isRecord(copy.raw["edited"]));
    const pool = edited.length > 0 ? edited : copies;
    if (new Set(pool.map((copy) => authoredTextOf({ record: copy }))).size > 1) {
      disagreeing.add(key);
      appendAll({ from: pool, into: current });
      continue;
    }
    current.push(speakerOf({ copies, pool }));
  }
  return { current, disagreeing };
}
