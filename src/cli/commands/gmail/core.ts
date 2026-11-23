/**
 * PURE argument handling for the `gmail` noun. Every verb's tail is parsed here and nowhere else, so a
 * malformed invocation is refused before a credential is read or a socket is opened — which is what lets
 * every `gmail` verb declare `parseRejectIsIoFree`.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { checkAttachmentSelector, DEFAULT_MAX_ATTACHMENT_BYTES } from "../../../live/gmail/attachment.js";
import { SYSTEM_LABELS } from "../../../live/gmail/labels.js";
import { boundedByteSample } from "../../../live/gmail/measure.js";
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from "../../../live/gmail/read.js";
import { collectRepeated, parseFlagTail, withoutRepeated } from "../../optionParsers.js";
import { slackReadErrorLines } from "../slack/readErrors.js";
import { parseMaxFileBytes } from "../slack/readThreadCore.js";
import { type GmailArgsError, GmailArgsErrors } from "./errors.js";

/** What a parser here returns: the request, or the one {@link GmailArgsError} that refused it. */
type Parsed<T> = Result<T, GmailArgsError>;

/**
 * A parsed `gmail list` invocation.
 *
 * @internal — the declared shape of `parseGmailListArgs`'s success value; no caller names it.
 */
export interface GmailListArgs {
  readonly home: string | undefined;
  readonly query: string | undefined;
  readonly labelIds: readonly string[];
  readonly limit: number;
  readonly json: boolean;
}

/**
 * A parsed `gmail read` invocation.
 *
 * @internal — the declared shape of `parseGmailReadArgs`'s success value; no caller names it.
 */
export interface GmailReadArgs {
  readonly home: string | undefined;
  readonly address: string;
  readonly thread: boolean;
  readonly json: boolean;
}

/** `gmail list` usage. */
const LIST_USAGE =
  "usage: slopweaver gmail list [--query <gmail-search>] [--label <ID>]... [--limit <1..100>] [--json] " +
  "[--home <dir>]\n" +
  "  Lists matching messages as metadata only — sender, subject, snippet, labels. No bodies\n" +
  "  --query   a Gmail search expression, exactly as the Gmail search box takes it\n" +
  "  --label   restrict to a label ID (repeatable); INBOX, UNREAD and STARRED are the built-in ones\n" +
  "  --limit   how many messages to read (default 25, maximum 100)";

/** `gmail read` usage. */
const READ_USAGE =
  "usage: slopweaver gmail read <message-id> [--thread] [--json] [--home <dir>]\n" +
  "  Reads one message in full, bodies included, and states what the read did not establish\n" +
  "  --thread  read every message in the thread the id names — a thread id, or any message's id in it\n" +
  "  --json    emit one machine-readable document with freshness, coverage and residue";

/**
 * A parsed `gmail measure` invocation.
 *
 * @internal — the declared shape of `parseGmailMeasureArgs`'s success value; no caller names it.
 */
export interface GmailMeasureArgs {
  readonly home: string | undefined;
  readonly query: string | undefined;
  readonly byteSample: number;
  readonly json: boolean;
}

/**
 * A parsed `gmail labels` invocation.
 *
 * @internal — the declared shape of `parseGmailLabelsArgs`'s success value; no caller names it.
 */
export interface GmailLabelsArgs {
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * What every `gmail` mutation verb parses down to. The three verbs differ only in how they NAME a label
 * change (see `src/live/gmail/labels.ts`), so they share one shape rather than three that could drift.
 *
 * @internal — the declared shape of the three mutation parsers' success values.
 */
export interface GmailModifyArgs {
  readonly home: string | undefined;
  /** Every message (or thread) id to change, deduplicated, in the order given. Only `archive` takes more than one. */
  readonly addresses: readonly string[];
  /** Label names or ids to add, exactly as written; the resolver turns names into ids. */
  readonly addRefs: readonly string[];
  /** Label names or ids to remove, exactly as written. */
  readonly removeRefs: readonly string[];
  readonly thread: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
  /** The verb's own word for what it does, carried into the plan and every report. */
  readonly intent: string;
}

/** `gmail measure` usage. */
const MEASURE_USAGE =
  "usage: slopweaver gmail measure [--query <gmail-search>] [--sample-bytes <0..500>] [--json] [--home <dir>]\n" +
  "  Sizes the mailbox BEFORE a full-history backfill — how many messages, how far back, how many bytes\n" +
  "  --query        measure within a Gmail search expression instead of the whole mailbox\n" +
  "  --sample-bytes how many messages to read for their size (default 40, maximum 500)\n" +
  "  The count and the two dates are EXACT; the byte figure is an estimate projected from the sample";

/** `gmail labels` usage. */
const LABELS_USAGE =
  "usage: slopweaver gmail labels [--json] [--home <dir>]\n" +
  "  Lists every label in the mailbox with its display name and the ID the API takes\n" +
  "  --json    emit one machine-readable document with freshness, coverage and residue";

/** `gmail label` usage. */
const LABEL_USAGE =
  "usage: slopweaver gmail label <message-id> [--add <name-or-id>]... [--remove <name-or-id>]... [--thread] " +
  "[--dry-run] [--json] [--home <dir>]\n" +
  "  Adds and removes labels on one message, or on every message in its thread\n" +
  "  --add     a label to add, by display name or ID (repeatable)\n" +
  "  --remove  a label to remove, by display name or ID (repeatable)\n" +
  "  --thread  treat the id as a THREAD id and change every message in it\n" +
  "  --dry-run resolve and print exactly what would change, and send nothing\n" +
  "  At least one --add or --remove is required. TRASH and SPAM cannot be added here";

/** `gmail mark` usage. */
const MARK_USAGE =
  "usage: slopweaver gmail mark <message-id> (--read | --unread) [--thread] [--dry-run] [--json] [--home <dir>]\n" +
  "  Marks one message read or unread — Gmail's UNREAD label, removed or added\n" +
  "  --read    mark it read\n" +
  "  --unread  mark it unread\n" +
  "  --thread  treat the id as a THREAD id and change every message in it\n" +
  "  --dry-run print exactly what would change, and send nothing\n" +
  "  Exactly one of --read or --unread is required — neither is a default";

/**
 * Every flag each `gmail` verb's parser accepts, derived from the exact specs the parsers above pass.
 *
 * Three flags here never reach `parseFlagTail` — `list`'s `--label`, and `label`'s `--add` and `--remove`.
 * They are pulled off the raw tail by {@link collectRepeated} first, precisely because they repeat. They ARE
 * accepted, so the help-truth contract has to say so — a flag the parser takes and the usage hides is the
 * same defect as the reverse.
 */
export const GMAIL_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = {
  archive: ["--dry-run", "--home", "--json", "--restore", "--thread"],
  attachment: ["--home", "--json", "--max-file-mb", "--name", "--part"],
  "card-mail": ["--fetch", "--home", "--json", "--message"],
  "clear-meeting-notes": ["--audit", "--dry-run", "--home", "--limit"],
  connect: ["--grant", "--home", "--json", "--revoke", "--status"],
  draft: ["--board", "--dry-run", "--expect", "--form", "--home", "--json", "--reply-to"],
  label: ["--add", "--dry-run", "--home", "--json", "--remove", "--thread"],
  labels: ["--home", "--json"],
  list: ["--home", "--json", "--label", "--limit", "--query"],
  mark: ["--dry-run", "--home", "--json", "--read", "--thread", "--unread"],
  measure: ["--home", "--json", "--query", "--sample-bytes"],
  read: ["--home", "--json", "--thread"],
  send: ["--approve", "--home", "--json"],
  triage: ["--card", "--home", "--json", "--key", "--limit", "--pin", "--ruled", "--write"],
  "triage-rules": ["--home", "--json", "--set"],
  unsubscribe: ["--dry-run", "--home", "--json"],
};

/** Read the optional `--home` value out of a parsed tail. */
function homeOf({ values }: { values: Readonly<Record<string, string>> }): string | undefined {
  return values["home"];
}

/**
 * Parse the `gmail list` tail. `--label` repeats, so it is read from the raw tail rather than from the
 * single-value bag — `parseFlagTail` keeps the LAST occurrence of a repeated value flag, which would
 * silently narrow a two-label search to one.
 *
 * @param rest the argv tail after `gmail list`
 * @returns the validated request, or every reason it was refused
 */
export function parseGmailListArgs({ rest }: { rest: readonly string[] }): Parsed<GmailListArgs> {
  const labelIds = collectRepeated({ name: "--label", rest });
  const parsed = parseFlagTail({
    rest: withoutRepeated({ name: "--label", rest }),
    spec: { boolean: ["json"], value: ["home", "limit", "query"] },
  });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: LIST_USAGE }));
  }
  const rawLimit = parsed.value.values["limit"];
  const limit = rawLimit === undefined ? DEFAULT_LIST_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    return err(GmailArgsErrors.limitOutOfRange({ got: String(rawLimit), max: MAX_LIST_LIMIT, usage: LIST_USAGE }));
  }
  return ok({
    home: homeOf({ values: parsed.value.values }),
    json: parsed.value.flags.has("json"),
    labelIds,
    limit,
    query: parsed.value.values["query"],
  });
}

/**
 * Parse the `gmail read` tail: one leading positional id, then flags.
 *
 * @param rest the argv tail after `gmail read`
 * @returns the validated request, or every reason it was refused
 */
export function parseGmailReadArgs({ rest }: { rest: readonly string[] }): Parsed<GmailReadArgs> {
  const address = rest[0];
  if (address === undefined || address.startsWith("-")) {
    return err(GmailArgsErrors.argumentMissing({ name: "<message-id>", usage: READ_USAGE }));
  }
  const parsed = parseFlagTail({ rest: rest.slice(1), spec: { boolean: ["json", "thread"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: READ_USAGE }));
  }
  return ok({
    address,
    home: homeOf({ values: parsed.value.values }),
    json: parsed.value.flags.has("json"),
    thread: parsed.value.flags.has("thread"),
  });
}

/**
 * Parse the `gmail measure` tail.
 *
 * `--sample-bytes` is clamped rather than refused, because every value outside the range still names a
 * coherent intent — `0` means "do not price it", a huge number means "price it as well as you can" — and
 * the bound this verb enforces is about keeping the measurement cheaper than the crawl it prices.
 *
 * @param rest the argv tail after `gmail measure`
 * @returns the validated request, or every reason it was refused
 */
export function parseGmailMeasureArgs({ rest }: { rest: readonly string[] }): Parsed<GmailMeasureArgs> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "query", "sample-bytes"] } });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: MEASURE_USAGE }));
  }
  const raw = parsed.value.values["sample-bytes"];
  if (raw !== undefined && !Number.isFinite(Number(raw))) {
    return err(GmailArgsErrors.sampleBytesNotANumber({ got: raw, usage: MEASURE_USAGE }));
  }
  return ok({
    byteSample: boundedByteSample({ requested: raw === undefined ? undefined : Number(raw) }),
    home: homeOf({ values: parsed.value.values }),
    json: parsed.value.flags.has("json"),
    query: parsed.value.values["query"],
  });
}

/**
 * Parse the `gmail labels` tail.
 *
 * @param rest the argv tail after `gmail labels`
 * @returns the validated request, or every reason it was refused
 */
export function parseGmailLabelsArgs({ rest }: { rest: readonly string[] }): Parsed<GmailLabelsArgs> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: LABELS_USAGE }));
  }
  return ok({ home: homeOf({ values: parsed.value.values }), json: parsed.value.flags.has("json") });
}

/**
 * Parse the `gmail label` tail: one leading positional id, then the repeatable `--add`/`--remove` pair.
 *
 * @param rest the argv tail after `gmail label`
 * @returns the validated request, or every reason it was refused
 */
export function parseGmailLabelArgs({ rest }: { rest: readonly string[] }): Parsed<GmailModifyArgs> {
  const address = rest[0];
  if (address === undefined || address.startsWith("-")) {
    return err(GmailArgsErrors.argumentMissing({ name: "<message-id>", usage: LABEL_USAGE }));
  }
  const tail = rest.slice(1);
  const addRefs = collectRepeated({ name: "--add", rest: tail });
  const removeRefs = collectRepeated({ name: "--remove", rest: tail });
  const parsed = parseFlagTail({
    rest: withoutRepeated({ name: "--remove", rest: withoutRepeated({ name: "--add", rest: tail }) }),
    spec: { boolean: ["dry-run", "json", "thread"], value: ["home"] },
  });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: LABEL_USAGE }));
  }
  if (addRefs.length === 0 && removeRefs.length === 0) {
    return err(GmailArgsErrors.nothingToChange({ usage: LABEL_USAGE }));
  }
  return ok({
    addRefs,
    addresses: [address],
    dryRun: parsed.value.flags.has("dry-run"),
    home: homeOf({ values: parsed.value.values }),
    intent: "label",
    json: parsed.value.flags.has("json"),
    removeRefs,
    thread: parsed.value.flags.has("thread"),
  });
}

/**
 * Parse the `gmail mark` tail. Neither direction is a default: a bare `gmail mark <id>` is refused rather
 * than guessing, because the two outcomes are opposites and the wrong one is invisible until someone
 * notices a message they had not read is no longer bold.
 *
 * @param rest the argv tail after `gmail mark`
 * @returns the validated request, or every reason it was refused
 */
export function parseGmailMarkArgs({ rest }: { rest: readonly string[] }): Parsed<GmailModifyArgs> {
  const address = rest[0];
  if (address === undefined || address.startsWith("-")) {
    return err(GmailArgsErrors.argumentMissing({ name: "<message-id>", usage: MARK_USAGE }));
  }
  const parsed = parseFlagTail({
    rest: rest.slice(1),
    spec: { boolean: ["dry-run", "json", "read", "thread", "unread"], value: ["home"] },
  });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: MARK_USAGE }));
  }
  const markRead = parsed.value.flags.has("read");
  const markUnread = parsed.value.flags.has("unread");
  if (markRead === markUnread) {
    return err(GmailArgsErrors.directionUnclear({ given: markRead ? "both" : "neither", usage: MARK_USAGE }));
  }
  return ok({
    addRefs: markUnread ? [SYSTEM_LABELS.unread] : [],
    addresses: [address],
    dryRun: parsed.value.flags.has("dry-run"),
    home: homeOf({ values: parsed.value.values }),
    intent: markUnread ? "mark unread" : "mark read",
    json: parsed.value.flags.has("json"),
    removeRefs: markRead ? [SYSTEM_LABELS.unread] : [],
    thread: parsed.value.flags.has("thread"),
  });
}

/**
 * A parsed `gmail attachment` invocation.
 *
 * @internal — the declared shape of `parseGmailAttachmentArgs`'s success value; no caller names it.
 */
export interface GmailAttachmentArgs {
  readonly home: string | undefined;
  readonly messageId: string;
  readonly name: string | undefined;
  readonly partId: string | undefined;
  readonly maxBytes: number;
  readonly json: boolean;
}

/** `gmail attachment` usage. */
const ATTACHMENT_USAGE =
  "usage: slopweaver gmail attachment <message-id> [--name <filename>] [--part <partId>] [--max-file-mb <n>] " +
  "[--json] [--home <dir>]\n" +
  "  Fetches ONE attachment's bytes and saves them owner-only under live/gmail/attachments/<message-id>/\n" +
  "  --name        the attachment's exact filename, as `gmail read` lists it\n" +
  "  --part        the attachment's part id — what a refusal lists when two attachments share a name\n" +
  "  --max-file-mb refuse, before fetching, an attachment larger than this (default 25)\n" +
  "  At least one of --name or --part is required; given both, both must match";

/**
 * Parse the `gmail attachment` tail: one leading positional message id, then the selector and ceiling.
 *
 * @param rest the argv tail after `gmail attachment`
 * @returns the validated request, or every reason it was refused
 */
export function parseGmailAttachmentArgs({ rest }: { rest: readonly string[] }): Parsed<GmailAttachmentArgs> {
  const messageId = rest[0];
  if (messageId === undefined || messageId.startsWith("-")) {
    return err(GmailArgsErrors.argumentMissing({ name: "<message-id>", usage: ATTACHMENT_USAGE }));
  }
  const parsed = parseFlagTail({
    rest: rest.slice(1),
    spec: { boolean: ["json"], value: ["home", "max-file-mb", "name", "part"] },
  });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: ATTACHMENT_USAGE }));
  }
  const { values } = parsed.value;
  const selector = checkAttachmentSelector({ name: values["name"], partId: values["part"] });
  if (selector.isErr()) {
    return err(GmailArgsErrors.selectorInvalid({ cause: selector.error, usage: ATTACHMENT_USAGE }));
  }
  const maxBytes = parseMaxFileBytes({ raw: values["max-file-mb"] });
  if (maxBytes.isErr()) {
    const got = String(values["max-file-mb"]);
    const reasons = slackReadErrorLines({ error: maxBytes.error });
    return err(GmailArgsErrors.maxFileSizeInvalid({ got, reasons, usage: ATTACHMENT_USAGE }));
  }
  // No --max-file-mb means the default ceiling, stated here rather than substituted by an operator.
  let ceiling = DEFAULT_MAX_ATTACHMENT_BYTES;
  if (maxBytes.value !== undefined) {
    ceiling = maxBytes.value;
  }
  return ok({
    home: homeOf({ values }),
    json: parsed.value.flags.has("json"),
    maxBytes: ceiling,
    messageId,
    name: selector.value.name,
    partId: selector.value.partId,
  });
}
