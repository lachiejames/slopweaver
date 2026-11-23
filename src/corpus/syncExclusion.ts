/**
 * The SYNC-side denylist — which authors never reach the corpus, in which places, and what rescues them.
 *
 * ## What it is for
 *
 * Datadog is excluded as an author: it gives no useful info because that info is already in Datadog, which
 * has better ways of searching it. Measured on this
 * install before the exclusion: one Slack app had written about a million records — **nearly half of every Slack record
 * and well over half of all corpus bytes** — carrying tens of thousands of distinct alert signatures between
 * them, a couple of dozen of which were half the million. It is the same handful of monitor alerts restated a million times, and the platform
 * that emitted them still answers about them live.
 *
 * ## The refinement that shapes the whole module
 *
 * This is a SYNC-only concept rather than a filter: some conversations involve the Datadog agent, and a bot
 * tagged in and reading the thread that cannot see what everyone else can see has a problem. So live reads
 * keep using Datadog, and only the sync excludes it.
 *
 * So a live thread read is NEVER filtered. That is a structural property here rather than a rule anyone has
 * to remember: nothing under `src/live/` imports this module, and
 * `unit/corpus/syncExclusionLiveReads.test.ts` fails if that ever stops being true. A bot tagged into a
 * thread sees exactly what every human in it sees.
 *
 * ## A denial is SCOPED to a channel, because an author ban was measurably too blunt
 *
 * Measured over a store of a couple of million
 * rows, a bare author ban takes **thousands of rows across a few dozen other channels**, because the same
 * Datadog app is nearly all of `#monitor-feed` and only a small fraction of `#sync-alerts`, where
 * humans are doing the talking.
 * So an entry may name a SCOPE: `<id> @ <channel>` denies that identity only in that channel, and a bare
 * `<id>` still denies it everywhere, which is what several installs already have written down.
 *
 * ## Rule D — a denied alert that humans replied under is kept
 *
 * Measured on the same store: `#monitor-feed` holds over a thousand human rows, of which **all but a
 * couple are thread replies** in hundreds of distinct threads spanning more than a year, and only a couple
 * are top-level channel messages. Those replies are production incidents being diagnosed. Keeping the alert
 * that STARTED such a thread costs **a few dozen rows** and is what stops a reply being an orphan, so a denied record is admitted anyway
 * when a non-bot message shares its thread ({@link humanThreadKeysIn}).
 *
 * Rule D is decided against a SET of thread keys rather than one record, because one record cannot know it.
 * {@link excludeFromSync} derives that set from the batch it was handed, which is exactly right for a
 * whole-array caller. A STREAMING caller cannot — a parent read before its human reply would be dropped —
 * so it defers: {@link syncExclusionVerdict} answers `defer` rather than `deny` for a denied record that
 * carries a thread coordinate with no human evidence YET, and the caller resolves the deferred set once the
 * whole input has been seen. The deferred set is bounded by how many DENIED rows carry a `thread_ts` at
 * all, which Slack only sets on a message that is in a thread: measured over the whole store,
 * **471** rows across every denied pair, 118 of them in `#monitor-feed`. Repro, a template:
 * `psql "$(cat ~/.slopweaver/secrets/store-url)" -c "select count(*) from content_slack where is_bot and
 * thread_ts is not null and app_id in ('<app id>','<app id>')"`, with the denied pair's two app ids from the off-repo list. That measurement is why this is a small
 * in-memory set and not an on-disk candidate index.
 *
 * ## Why the ids live off-repo
 *
 * A Slack author id, bot id, app id or channel name names one workspace's own accounts, so it is a private
 * identifier and cannot be committed — the same reason `hygiene-denylist.txt` and `org-domains.txt` live
 * under the home. This module ships the MECHANISM and names no id; the install supplies the list at
 * `$SLOPWEAVER_HOME/sync-author-denylist.txt`. An install with no file excludes nothing, which is the
 * correct default for a fresh home.
 *
 * ## What it does NOT do
 *
 * It never deletes anything already on disk. Bronze is the durable capture, the exclusion is about what gets
 * indexed, and that is what makes a store purge reversible rather than final — see
 * {@link ../store/syncExclusionStore.purgeExcludedContent}.
 */

import { loadLineListResult } from "../hygiene/scan.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import type { CorpusRecord } from "./types.js";

/** The `raw` keys that carry an identity a denylist entry may name, checked in this order. */
const RAW_IDENTITY_KEYS: readonly string[] = ["app_id", "bot_id", "user"];

/** The `raw` keys whose presence proves a Slack message came from an app rather than a person. */
const RAW_BOT_MARKER_KEYS: readonly string[] = ["app_id", "bot_id"];

/** What separates an identity from the channel it is scoped to, in a denylist line. */
const SCOPE_SEPARATOR = "@";

/**
 * Where one scoped entry applies.
 *
 * Two kinds rather than one because they fail differently and a reader has to know which they wrote. A
 * channel ID is stable across a rename and unreadable to a human; a channel NAME is the thing an operator
 * can actually type and stops matching the day somebody renames the channel. Neither is a substring match.
 *
 * @internal — a field type of {@link ScopedSyncExclusion}.
 */
export type SyncScope =
  { readonly kind: "channel-id"; readonly value: string } | { readonly kind: "channel-name"; readonly value: string };

/**
 * One identity denied in one place, rather than everywhere.
 *
 * @internal — a field type of {@link SyncExclusion}; callers read the exclusion, never a rule alone.
 */
export interface ScopedSyncExclusion {
  /** The app, bot or user id, lowercased. */
  readonly id: string;
  /** The one channel this denial applies in. */
  readonly scope: SyncScope;
}

/** The resolved denylist: the ids no sync or index run may admit, and where each denial applies. */
export interface SyncExclusion {
  /**
   * Every GLOBALLY denied id, lowercased. One set rather than three, because an id's KIND is not knowable
   * here — an install may name an app id, a bot id or a user id and each reaches a different projection.
   */
  readonly ids: ReadonlySet<string>;
  /** Every denial that applies in ONE channel only. */
  readonly scoped: readonly ScopedSyncExclusion[];
  /** Where the list was read from, so a report can name the file rather than the concept. */
  readonly path: string;
}

/**
 * The thread coordinates a human has been seen speaking in — rule D's whole input.
 *
 * A set of opaque keys rather than a channel/ts pair, because the only operation is membership and a
 * channel-qualified key is what stops one channel's thread rescuing another's ({@link slackThreadKey}).
 */
export interface HumanThreadContext {
  readonly keys: ReadonlySet<string>;
}

/**
 * What the policy says about one record.
 *
 * `defer` exists because a streaming caller cannot answer `deny` honestly: the record is denied on
 * identity, carries a thread coordinate, and the human evidence that would rescue it may be on a line this
 * caller has not read yet. A whole-array caller never sees it, because it can compute the evidence first.
 */
export type SyncExclusionVerdict = "admit" | "deny" | "defer";

/**
 * A denylist that excludes nothing — a fresh home, and the shape a caller with no home injects.
 *
 * @returns an exclusion holding no ids, which admits every record
 */
export function emptySyncExclusion(): SyncExclusion {
  return { ids: new Set(), path: "", scoped: [] };
}

/**
 * The key one thread is remembered under.
 *
 * Channel-qualified, and joined by a character neither half can contain: a Slack channel id is letters and
 * digits, a Slack timestamp is digits and one dot. So no two pairs can collide into one key, and one
 * channel can never rescue another channel's thread.
 *
 * @returns the membership key for this thread
 */
export function slackThreadKey({ channelId, threadTs }: { channelId: string; threadTs: string }): string {
  return `${channelId.toLowerCase()}${THREAD_KEY_SEPARATOR}${threadTs}`;
}

/**
 * What joins a channel to a thread timestamp in a key.
 *
 * A forward slash rather than a control byte: the byte would be invisible in a diff and is what the
 * `control-bytes` gate refuses, and no Slack channel id or timestamp contains a slash, so the collision
 * guarantee is the same while the key stays readable in a log.
 */
const THREAD_KEY_SEPARATOR = "/";

/**
 * Parse the denylist's lines into global ids and scoped pairs.
 *
 * Exported because it is the whole policy contract and the only part worth testing without a file. A line
 * is either a bare id or `<id> @ <channel>`; a channel beginning `#` is a NAME and anything else is an ID,
 * which is why the loader must not treat `#` as a comment marker anywhere but the start of a line.
 *
 * @param lines the non-blank, non-comment lines already read from the file
 * @param path where they came from, carried into the result so a report can name the file
 * @returns the resolved denylist, or every malformed line, since an operator fixing a list wants them all
 */
export function parseSyncExclusionLines({
  lines,
  path,
}: {
  lines: readonly string[];
  path: string;
}): Result<SyncExclusion> {
  const ids = new Set<string>();
  const scoped: ScopedSyncExclusion[] = [];
  const problems: string[] = [];

  lines.forEach((line) => {
    const at = line.indexOf(SCOPE_SEPARATOR);
    if (at < 0) {
      ids.add(line.toLowerCase());
      return;
    }
    const id = line.slice(0, at).trim().toLowerCase();
    const channel = line.slice(at + SCOPE_SEPARATOR.length).trim();
    if (id.length === 0 || channel.length === 0) {
      problems.push(`${path}: "${line}" is not <id> @ <channel> — both sides must be non-empty`);
      return;
    }
    if (channel.includes(SCOPE_SEPARATOR)) {
      problems.push(`${path}: "${line}" carries more than one "${SCOPE_SEPARATOR}" — a scope names one channel`);
      return;
    }
    scoped.push({ id, scope: scopeFor({ channel }) });
  });

  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ ids, path, scoped });
}

/**
 * Read the install's denylist.
 *
 * An ABSENT file excludes nothing and is not an error: that is a fresh home. An UNREADABLE file IS an
 * error, and deliberately so — the failure it would otherwise cause is silent and expensive. A refresh that
 * shrugged at an unreadable list would index the million rows the list exists to keep out, report a
 * perfectly ordinary success, and be discovered days later by someone wondering why the corpus grew. A
 * MALFORMED line is an error for the same reason: a scope nobody can parse is a denial that silently does
 * not apply.
 *
 * @param home the Slopweaver home (defaults to the resolved home)
 * @param readText the reader, injected so a test needs no file
 * @returns the resolved denylist, or the reason the existing file could not be used
 */
export function loadSyncExclusion({
  home,
  readText,
}: {
  home?: string;
  readText?: (args: { path: string }) => string;
} = {}): Result<SyncExclusion> {
  const path = stateHomePaths(home === undefined ? {} : { home }).syncAuthorDenylist;
  const loaded = loadLineListResult({ path, ...(readText === undefined ? {} : { readText }) });
  if (loaded.kind === "unreadable") {
    return err([
      `sync-author denylist at ${path} exists but could not be read (${loaded.reason}). Refusing to sync ` +
        `with an empty denylist — that would silently re-admit every author the list exists to keep out.`,
    ]);
  }
  if (loaded.kind === "absent") {
    return ok({ ids: new Set(), path, scoped: [] });
  }
  return parseSyncExclusionLines({ lines: loaded.lines, path });
}

/**
 * The committer's denylist resolver: read once, on the FIRST commit, then held.
 *
 * Lazy for two reasons that both matter. The load can fail and a constructor returning no `Result` has
 * nowhere to say so — as a COMMIT failure it refuses the write, which is the only safe direction. And a
 * per-container run builds one committer and commits hundreds of times, so caching reads the file once for
 * the whole refresh rather than once per conversation.
 *
 * @param home the Slopweaver home the denylist is read from
 * @param exclusion an already-resolved denylist (tests inject one; production passes none)
 * @returns a thunk yielding the denylist, or the load failure
 */
export function lazyExclusion({
  home,
  exclusion,
}: {
  home: string;
  exclusion?: SyncExclusion;
}): () => Result<SyncExclusion> {
  let held: SyncExclusion | undefined = exclusion;
  return () => {
    if (held !== undefined) {
      return ok(held);
    }
    const loaded = loadSyncExclusion({ home });
    if (loaded.isErr()) {
      return err(loaded.error);
    }
    held = loaded.value;
    return ok(held);
  };
}

/**
 * Every thread a human has been seen speaking in, across these records.
 *
 * This is rule D's evidence, and it is gathered from the SAME records a filter is about to judge, so a
 * whole-array caller needs no second source. A record counts as human evidence only when it is a Slack
 * message carrying no app or bot marker at all — a missing payload is UNKNOWN, never human, because the
 * whole point is that an alert must not rescue itself.
 *
 * @param records the batch to read evidence from
 * @returns the thread keys a human was seen in
 */
export function humanThreadKeysIn({ records }: { records: readonly CorpusRecord[] }): HumanThreadContext {
  const keys = new Set<string>();
  records.forEach((record) => {
    const key = humanThreadKeyOf({ record });
    if (key !== null) {
      keys.add(key);
    }
  });
  return { keys };
}

/**
 * The thread key this record is EVIDENCE for, when it is evidence at all.
 *
 * Exported for the streaming caller, which cannot collect evidence with
 * {@link humanThreadKeysIn} because it never holds the whole input at once — it accumulates one key at a
 * time into a set it owns. Returning null for both "not human" and "not in a thread" is deliberate: a
 * caller that had to distinguish them would be making rule D's decision twice.
 *
 * @param record the record to read
 * @returns the thread key a human was seen in, or null when this record is not that evidence
 */
export function humanThreadKeyOf({ record }: { record: CorpusRecord }): string | null {
  if (!isHumanSlackMessage({ record })) {
    return null;
  }
  return threadKeyOf({ record });
}

/**
 * The thread this record sits in, whoever wrote it.
 *
 * Exported so a deferring caller can key its held records by the same coordinate the evidence arrives
 * under — a second spelling of this would be the bug that makes rule D silently never fire.
 *
 * @param record the record to read
 * @returns the key, or null when this record is not in a thread
 */
export function threadKeyFor({ record }: { record: CorpusRecord }): string | null {
  return threadKeyOf({ record });
}

/**
 * What the policy says about one record, including rule D.
 *
 * @param record the record to judge
 * @param exclusion the resolved denylist
 * @param humanThreads the thread keys a human has been seen in, so far
 * @returns `admit` when no entry names it, `deny` when one does and nothing rescues it, and `defer` when
 *   one does but the record sits in a thread whose human evidence a streaming caller may not have read yet
 */
export function syncExclusionVerdict({
  record,
  exclusion,
  humanThreads,
}: {
  record: CorpusRecord;
  exclusion: SyncExclusion;
  humanThreads: HumanThreadContext;
}): SyncExclusionVerdict {
  if (!isDenied({ exclusion, record })) {
    return "admit";
  }
  const key = threadKeyOf({ record });
  if (key === null) {
    return "deny";
  }
  if (humanThreads.keys.has(key)) {
    return "admit";
  }
  return "defer";
}

/**
 * Whether one record's identity is denied, in the place it was written.
 *
 * Four identities are checked rather than one, because they are available at different points of the
 * pipeline. `author` is a top-level field that survives EVERY projection, so it is the only one a read-side
 * filter can rely on. `raw.app_id`, `raw.bot_id` and `raw.user` are present at ingest and are the stabler
 * keys — an app keeps its id across a reinstall that mints the bot a new one — so an install can name any
 * of them and have the write path catch it. A record whose `raw` was projected away simply falls back to
 * `author`, which is why an install listing ONLY an app id excludes new records and not historical ones.
 *
 * This answers on IDENTITY and SCOPE only. Rule D is not its business — see
 * {@link syncExclusionVerdict}, which is what a caller should reach for.
 *
 * @param record the record to judge
 * @param exclusion the resolved denylist
 * @returns true when an entry names this record's identity in this record's channel
 */
export function isSyncExcluded({ record, exclusion }: { record: CorpusRecord; exclusion: SyncExclusion }): boolean {
  return isDenied({ exclusion, record });
}

/** What a filtering pass kept, and how much it dropped. */
export interface SyncExclusionOutcome {
  readonly kept: readonly CorpusRecord[];
  readonly excluded: number;
  /** How many denied records rule D put back, so a report can say the rescue is working. */
  readonly rescued: number;
}

/**
 * Drop every denied record from a batch, counting what went and what rule D put back.
 *
 * The human-thread evidence is derived from the batch itself rather than taken as a parameter, because a
 * whole-array caller always has it and a caller that had to remember to pass it would eventually not. That
 * is also why `defer` and `deny` are the same outcome here: a deferral exists so a STREAMING caller can
 * wait for evidence it has not read yet, and this caller has already read everything it is ever going to.
 *
 * The counts are returned rather than logged, because every caller reports them in its own voice and a
 * silently filtered batch is the thing this whole feature must not become — a corpus that quietly holds
 * less than its operator thinks is worse than one that holds junk.
 *
 * @param records the batch to filter
 * @param exclusion the resolved denylist
 * @returns the survivors, the number dropped, and the number rule D rescued
 */
export function excludeFromSync({
  records,
  exclusion,
}: {
  records: readonly CorpusRecord[];
  exclusion: SyncExclusion;
}): SyncExclusionOutcome {
  if (exclusion.ids.size === 0 && exclusion.scoped.length === 0) {
    return { excluded: 0, kept: records, rescued: 0 };
  }
  const humanThreads = humanThreadKeysIn({ records });
  const kept: CorpusRecord[] = [];
  let rescued = 0;
  records.forEach((record) => {
    const verdict = syncExclusionVerdict({ exclusion, humanThreads, record });
    if (verdict === "deny" || verdict === "defer") {
      return;
    }
    if (isDenied({ exclusion, record })) {
      rescued += 1;
    }
    kept.push(record);
  });
  return { excluded: records.length - kept.length, kept, rescued };
}

/**
 * Which kind of scope a written channel is.
 *
 * @param channel the right-hand side of a scoped entry, already trimmed
 * @returns a name scope for a leading `#`, an id scope otherwise
 */
function scopeFor({ channel }: { channel: string }): SyncScope {
  if (channel.startsWith("#")) {
    return { kind: "channel-name", value: channel.toLowerCase() };
  }
  return { kind: "channel-id", value: channel.toLowerCase() };
}

/**
 * Every identity this record could be denied under, lowercased.
 *
 * @param record the record to read
 * @returns the identities, which may be empty
 */
function identitiesOf({ record }: { record: CorpusRecord }): readonly string[] {
  const found: string[] = [];
  const author = record.author;
  if (typeof author === "string" && author.length > 0) {
    found.push(author.toLowerCase());
  }
  const raw = record.raw;
  if (!isRecord(raw)) {
    return found;
  }
  RAW_IDENTITY_KEYS.forEach((key) => {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) {
      found.push(value.toLowerCase());
    }
  });
  return found;
}

/**
 * Whether an entry names this record's identity in the place it was written.
 *
 * @param record the record to judge
 * @param exclusion the resolved denylist
 * @returns true when a global id or a scoped pair matches
 */
function isDenied({ record, exclusion }: { record: CorpusRecord; exclusion: SyncExclusion }): boolean {
  if (exclusion.ids.size === 0 && exclusion.scoped.length === 0) {
    return false;
  }
  const identities = identitiesOf({ record });
  if (identities.some((identity) => exclusion.ids.has(identity))) {
    return true;
  }
  if (record.source !== "slack") {
    return false;
  }
  return exclusion.scoped.some((rule) => identities.includes(rule.id) && scopeMatches({ record, scope: rule.scope }));
}

/**
 * Whether one scope names the channel this record was written in.
 *
 * An ID is the last segment of the record's container (`slack/C123`), which survives every projection. A
 * NAME is the `channel` attribute the Slack projection stamps, compared exactly rather than by substring,
 * so `#alerts` never matches `#alerts-platform`.
 *
 * @param record the record to judge
 * @param scope the one channel a rule applies in
 * @returns true when they are the same channel
 */
function scopeMatches({ record, scope }: { record: CorpusRecord; scope: SyncScope }): boolean {
  if (scope.kind === "channel-id") {
    return channelIdOf({ record }) === scope.value;
  }
  const named = record.attrs?.["channel"];
  return typeof named === "string" && named.toLowerCase() === scope.value;
}

/**
 * The channel id a record was written in, lowercased.
 *
 * @param record the record to read
 * @returns the id, or an empty string when the container carries none
 */
function channelIdOf({ record }: { record: CorpusRecord }): string {
  const container = record.container;
  const slash = container.lastIndexOf("/");
  const tail = slash < 0 ? container : container.slice(slash + 1);
  return tail.toLowerCase();
}

/**
 * Whether this record is a Slack message a PERSON wrote.
 *
 * Deliberately conservative in both directions: a record with no `raw` at all is UNKNOWN rather than human,
 * because rule D's whole job is to let human evidence rescue an alert and an alert that could rescue itself
 * would defeat it.
 *
 * @param record the record to judge
 * @returns true when it is a Slack message carrying no app or bot marker
 */
function isHumanSlackMessage({ record }: { record: CorpusRecord }): boolean {
  if (record.source !== "slack") {
    return false;
  }
  const raw = record.raw;
  if (!isRecord(raw)) {
    return false;
  }
  return !RAW_BOT_MARKER_KEYS.some((key) => {
    const marker = raw[key];
    return typeof marker === "string" && marker.length > 0;
  });
}

/**
 * The thread this record sits in, as a membership key.
 *
 * A reply carries `thread_ts`; a root that has replies carries its own `ts` there too, which is why Slack
 * only sets the field at all once a message is in a thread. A record with neither is not in a thread and
 * rule D has nothing to say about it. The record's own `sourceId` is never a fallback: Slack source ids are
 * compound channel-qualified coordinates, not timestamps.
 *
 * @param record the record to read
 * @returns the key, or null when this record is not in a thread
 */
function threadKeyOf({ record }: { record: CorpusRecord }): string | null {
  if (record.source !== "slack") {
    return null;
  }
  const raw = record.raw;
  if (!isRecord(raw)) {
    return null;
  }
  const threadTs = raw["thread_ts"];
  if (typeof threadTs !== "string" || threadTs.length === 0) {
    return null;
  }
  const channelId = channelIdOf({ record });
  if (channelId.length === 0) {
    return null;
  }
  return slackThreadKey({ channelId, threadTs });
}
