/**
 * PURE argument handling for the `outlook` verbs that READ, and the tokenising every verb shares; the writing
 * verbs parse in `writeCore.ts`, `connect` in `connectCore.ts`. A malformed invocation is refused here, before
 * a credential is read or a socket opened, which is what lets every `outlook` verb declare
 * `parseRejectIsIoFree`.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import {
  DEFAULT_OUTLOOK_ATTACHMENT_MAX_BYTES,
  type OutlookAttachmentSelector,
} from "../../../live/outlook/attachments.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type OutlookArgsError, OutlookArgsErrors } from "./errors.js";
import {
  OUTLOOK_ATTACHMENT_USAGE,
  OUTLOOK_LIST_USAGE,
  OUTLOOK_MEASURE_USAGE,
  OUTLOOK_READ_USAGE,
  OUTLOOK_TRIAGE_USAGE,
} from "./outlookUsage.js";

/** What a parser here returns: the request, or the one {@link OutlookArgsError} that refused it. */
export type Parsed<T> = Result<T, OutlookArgsError>;

/** How many messages `list` and `triage` read when `--limit` is not given. */
export const DEFAULT_OUTLOOK_LIST_LIMIT = 20;

/** The most messages one `list` or `triage` reads — Graph's own page ceiling for a message list. */
const MAX_OUTLOOK_LIST_LIMIT = 100;

/** The two fields every verb parses the same way. */
export interface OutlookCommonArgs {
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `outlook list`. */
export interface OutlookListArgs extends OutlookCommonArgs {
  readonly folder: string;
  readonly query: string | undefined;
  readonly unreadOnly: boolean;
  readonly limit: number;
}

/** A parsed `outlook read`. */
export interface OutlookReadArgs extends OutlookCommonArgs {
  readonly id: string;
  readonly thread: boolean;
}

/** A parsed `outlook attachment`. */
export interface OutlookAttachmentArgs extends OutlookCommonArgs {
  readonly messageId: string;
  readonly selector: OutlookAttachmentSelector;
  readonly maxBytes: number;
}

/** A parsed `outlook measure`. */
export interface OutlookMeasureArgs extends OutlookCommonArgs {
  readonly folder: string | undefined;
}

/** A parsed `outlook triage`. */
export interface OutlookTriageArgs extends OutlookCommonArgs {
  readonly limit: number;
}

/**
 * Every flag each `outlook` verb's parser accepts — what the help-truth contract compares each usage line to.
 * `category`'s `--add` and `--remove` repeat, so they are read off the raw tail before `parseFlagTail` sees it.
 */
export const OUTLOOK_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = {
  archive: ["--dry-run", "--home", "--json", "--restore", "--thread"],
  attachment: ["--attachment-id", "--home", "--json", "--max-file-mb", "--name"],
  categories: ["--home", "--json"],
  category: ["--add", "--dry-run", "--home", "--json", "--remove", "--thread"],
  connect: ["--calendar", "--disconnect", "--grant", "--home", "--json", "--status"],
  draft: ["--dry-run", "--form", "--home", "--json", "--reply-to"],
  folders: ["--home", "--json"],
  list: ["--folder", "--home", "--json", "--limit", "--query", "--unread"],
  mark: ["--dry-run", "--home", "--json", "--read", "--thread", "--unread"],
  measure: ["--folder", "--home", "--json"],
  read: ["--home", "--json", "--thread"],
  send: ["--approve", "--home", "--json"],
  triage: ["--home", "--json", "--limit"],
};

/**
 * The leading positional a verb needs, or the refusal naming it.
 *
 * @param name the placeholder the usage line spells, named in the refusal
 * @param usage the verb's usage, printed with a refusal
 * @returns the id, or a refusal when the tail is empty or a flag stands first
 */
export function leadingId({
  rest,
  name,
  usage,
}: {
  rest: readonly string[];
  name: string;
  usage: string;
}): Parsed<string> {
  const [first] = rest;
  if (first === undefined || first.startsWith("-")) {
    return err(OutlookArgsErrors.argumentMissing({ name, usage }));
  }
  return ok(first);
}

/**
 * Tokenise a flag tail. `--json` and `--home` are accepted by every verb, so they are always added.
 *
 * @param boolean the switches this verb takes beyond `--json`
 * @param value the valued flags this verb takes beyond `--home`
 * @param usage the verb's usage, printed with a refusal
 * @returns the set switches and the valued flags, or a refusal carrying every tokenising problem
 */
export function flagTail({
  rest,
  boolean,
  value,
  usage,
}: {
  rest: readonly string[];
  boolean: readonly string[];
  value: readonly string[];
  usage: string;
}): Parsed<{ flags: ReadonlySet<string>; values: Readonly<Record<string, string>> }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: [...boolean, "json"], value: [...value, "home"] } });
  if (parsed.isErr()) {
    return err(OutlookArgsErrors.flagsInvalid({ reasons: parsed.error, usage }));
  }
  return ok(parsed.value);
}

/** `--limit`, 1..{@link MAX_OUTLOOK_LIST_LIMIT}, or the default when absent. */
function parseLimit({ raw, usage }: { raw: string | undefined; usage: string }): Parsed<number> {
  if (raw === undefined) {
    return ok(DEFAULT_OUTLOOK_LIST_LIMIT);
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_OUTLOOK_LIST_LIMIT) {
    const message = `--limit must be a whole number from 1 to ${String(MAX_OUTLOOK_LIST_LIMIT)} (got ${raw})`;
    return err(OutlookArgsErrors.invalidValue({ flag: "--limit", got: raw, message, usage }));
  }
  return ok(limit);
}

/**
 * Parse the `outlook list` tail.
 *
 * @param rest the argv tail after `outlook list`
 * @returns the request, or why it was refused
 */
export function parseOutlookListArgs({ rest }: { rest: readonly string[] }): Parsed<OutlookListArgs> {
  const usage = OUTLOOK_LIST_USAGE;
  const tail = flagTail({ boolean: ["unread"], rest, usage, value: ["folder", "limit", "query"] });
  if (tail.isErr()) {
    return err(tail.error);
  }
  const { flags, values } = tail.value;
  const limit = parseLimit({ raw: values["limit"], usage });
  if (limit.isErr()) {
    return err(limit.error);
  }
  // A destructured default rather than an operator: the inbox is what an unflagged `list` means, a policy choice.
  const { folder = "inbox" } = values;
  return ok({
    folder,
    home: values["home"],
    json: flags.has("json"),
    limit: limit.value,
    query: values["query"],
    unreadOnly: flags.has("unread"),
  });
}

/**
 * Parse the `outlook read` tail: one message id, then flags.
 *
 * @param rest the argv tail after `outlook read`
 * @returns the request, or why it was refused
 */
export function parseOutlookReadArgs({ rest }: { rest: readonly string[] }): Parsed<OutlookReadArgs> {
  const usage = OUTLOOK_READ_USAGE;
  const id = leadingId({ name: "<message-id>", rest, usage });
  if (id.isErr()) {
    return err(id.error);
  }
  const tail = flagTail({ boolean: ["thread"], rest: rest.slice(1), usage, value: [] });
  if (tail.isErr()) {
    return err(tail.error);
  }
  const { flags, values } = tail.value;
  return ok({ home: values["home"], id: id.value, json: flags.has("json"), thread: flags.has("thread") });
}

/** `--max-file-mb` as a byte ceiling: a positive whole number of MiB, or the default when absent. */
function parseMaxBytes({ raw, usage }: { raw: string | undefined; usage: string }): Parsed<number> {
  if (raw === undefined) {
    return ok(DEFAULT_OUTLOOK_ATTACHMENT_MAX_BYTES);
  }
  const megabytes = Number(raw);
  if (!Number.isInteger(megabytes) || megabytes < 1) {
    const message = `--max-file-mb must be a positive whole number (got ${raw})`;
    return err(OutlookArgsErrors.invalidValue({ flag: "--max-file-mb", got: raw, message, usage }));
  }
  return ok(megabytes * 1024 * 1024);
}

/**
 * Parse the `outlook attachment` tail: one message id, then exactly one of `--name` and `--attachment-id`.
 *
 * @param rest the argv tail after `outlook attachment`
 * @returns the request, or why it was refused
 */
export function parseOutlookAttachmentArgs({ rest }: { rest: readonly string[] }): Parsed<OutlookAttachmentArgs> {
  const usage = OUTLOOK_ATTACHMENT_USAGE;
  const id = leadingId({ name: "<message-id>", rest, usage });
  if (id.isErr()) {
    return err(id.error);
  }
  const tail = flagTail({ boolean: [], rest: rest.slice(1), usage, value: ["attachment-id", "max-file-mb", "name"] });
  if (tail.isErr()) {
    return err(tail.error);
  }
  const { flags, values } = tail.value;
  const name = values["name"];
  const attachmentId = values["attachment-id"];
  if (name !== undefined && attachmentId !== undefined) {
    return err(OutlookArgsErrors.modesConflict({ flags: ["--name", "--attachment-id"], usage }));
  }
  const maxBytes = parseMaxBytes({ raw: values["max-file-mb"], usage });
  if (maxBytes.isErr()) {
    return err(maxBytes.error);
  }
  let selector: OutlookAttachmentSelector;
  if (name !== undefined) {
    selector = { name };
  } else if (attachmentId !== undefined) {
    selector = { attachmentId };
  } else {
    const message = "name the attachment with --name <file> or --attachment-id <id>";
    return err(OutlookArgsErrors.flagMissing({ flag: "--name", message, usage }));
  }
  return ok({ home: values["home"], json: flags.has("json"), maxBytes: maxBytes.value, messageId: id.value, selector });
}

/**
 * Parse the tail of a verb that takes only `--json` and `--home` (`folders`, `categories`).
 *
 * @param rest the argv tail after the verb
 * @param usage the verb's usage, printed with a refusal
 * @returns the request, or why it was refused
 */
export function parseOutlookViewArgs({
  rest,
  usage,
}: {
  rest: readonly string[];
  usage: string;
}): Parsed<OutlookCommonArgs> {
  const tail = flagTail({ boolean: [], rest, usage, value: [] });
  if (tail.isErr()) {
    return err(tail.error);
  }
  return ok({ home: tail.value.values["home"], json: tail.value.flags.has("json") });
}

/**
 * Parse the `outlook measure` tail.
 *
 * @param rest the argv tail after `outlook measure`
 * @returns the request, or why it was refused
 */
export function parseOutlookMeasureArgs({ rest }: { rest: readonly string[] }): Parsed<OutlookMeasureArgs> {
  const tail = flagTail({ boolean: [], rest, usage: OUTLOOK_MEASURE_USAGE, value: ["folder"] });
  if (tail.isErr()) {
    return err(tail.error);
  }
  const { flags, values } = tail.value;
  return ok({ folder: values["folder"], home: values["home"], json: flags.has("json") });
}

/**
 * Parse the `outlook triage` tail.
 *
 * @param rest the argv tail after `outlook triage`
 * @returns the request, or why it was refused
 */
export function parseOutlookTriageArgs({ rest }: { rest: readonly string[] }): Parsed<OutlookTriageArgs> {
  const usage = OUTLOOK_TRIAGE_USAGE;
  const tail = flagTail({ boolean: [], rest, usage, value: ["limit"] });
  if (tail.isErr()) {
    return err(tail.error);
  }
  const limit = parseLimit({ raw: tail.value.values["limit"], usage });
  if (limit.isErr()) {
    return err(limit.error);
  }
  return ok({ home: tail.value.values["home"], json: tail.value.flags.has("json"), limit: limit.value });
}
