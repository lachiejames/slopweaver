/**
 * PURE argument handling for the `outlook` verbs that WRITE — `category`, `mark`, `archive`, `draft` and
 * `send`. The read verbs and the shared tokenising live in `core.ts`; the split is read versus write, the same
 * line the door draws.
 */
import { err, ok } from "../../../lib/result.js";
import { collectRepeated, withoutRepeated } from "../../optionParsers.js";
import { flagTail, leadingId, type OutlookCommonArgs, type Parsed } from "./core.js";
import { OutlookArgsErrors } from "./errors.js";
import {
  OUTLOOK_ARCHIVE_USAGE,
  OUTLOOK_CATEGORY_USAGE,
  OUTLOOK_DRAFT_USAGE,
  OUTLOOK_MARK_USAGE,
  OUTLOOK_SEND_USAGE,
} from "./outlookUsage.js";

/** The most ids one `archive` takes: each is its own read and write, so this bounds one invocation's requests. */
export const MAX_OUTLOOK_ARCHIVE_IDS = 100;

/** `--form -` reads the form from stdin, the sentinel every outbound lane here uses. */
export const OUTLOOK_STDIN_SENTINEL = "-";

/** What one change verb asks for, before anything is read. */
export type OutlookChangeRequest =
  | { readonly kind: "mark"; readonly read: boolean }
  | { readonly kind: "category"; readonly add: readonly string[]; readonly remove: readonly string[] }
  | { readonly kind: "archive"; readonly restore: boolean };

/** A parsed `outlook category`, `mark` or `archive`. */
export interface OutlookChangeArgs extends OutlookCommonArgs {
  readonly ids: readonly string[];
  readonly thread: boolean;
  readonly dryRun: boolean;
  readonly request: OutlookChangeRequest;
}

/** A parsed `outlook draft`; `formSource` is the raw `--form` value, since reading stdin is the shell's I/O. */
export interface OutlookDraftArgs extends OutlookCommonArgs {
  readonly formSource: string;
  readonly replyTo: string | undefined;
  readonly dryRun: boolean;
}

/** A parsed `outlook send`. */
export interface OutlookSendArgs extends OutlookCommonArgs {
  readonly draftId: string;
  readonly approve: string | undefined;
}

/** The switches every change verb shares, off one tokenised tail. */
function changeCommon({
  flags,
  values,
}: {
  flags: ReadonlySet<string>;
  values: Readonly<Record<string, string>>;
}): Omit<OutlookChangeArgs, "ids" | "request"> {
  return { dryRun: flags.has("dry-run"), home: values["home"], json: flags.has("json"), thread: flags.has("thread") };
}

/**
 * Parse the `outlook category` tail: one message id, then at least one `--add` or `--remove`.
 *
 * @param rest the argv tail after `outlook category`
 * @returns the request, or why it was refused
 */
export function parseOutlookCategoryArgs({ rest }: { rest: readonly string[] }): Parsed<OutlookChangeArgs> {
  const usage = OUTLOOK_CATEGORY_USAGE;
  const id = leadingId({ name: "<message-id>", rest, usage });
  if (id.isErr()) {
    return err(id.error);
  }
  const flagsOnly = rest.slice(1);
  const add = collectRepeated({ name: "--add", rest: flagsOnly });
  const remove = collectRepeated({ name: "--remove", rest: flagsOnly });
  const stripped = withoutRepeated({ name: "--remove", rest: withoutRepeated({ name: "--add", rest: flagsOnly }) });
  const tail = flagTail({ boolean: ["dry-run", "thread"], rest: stripped, usage, value: [] });
  if (tail.isErr()) {
    return err(tail.error);
  }
  if (add.length === 0 && remove.length === 0) {
    return err(OutlookArgsErrors.nothingToChange({ message: "give at least one --add or --remove", usage }));
  }
  return ok({ ...changeCommon(tail.value), ids: [id.value], request: { add, kind: "category", remove } });
}

/**
 * Parse the `outlook mark` tail: one message id, then exactly one of `--read` and `--unread`.
 *
 * @param rest the argv tail after `outlook mark`
 * @returns the request, or why it was refused
 */
export function parseOutlookMarkArgs({ rest }: { rest: readonly string[] }): Parsed<OutlookChangeArgs> {
  const usage = OUTLOOK_MARK_USAGE;
  const id = leadingId({ name: "<message-id>", rest, usage });
  if (id.isErr()) {
    return err(id.error);
  }
  const tail = flagTail({ boolean: ["dry-run", "read", "thread", "unread"], rest: rest.slice(1), usage, value: [] });
  if (tail.isErr()) {
    return err(tail.error);
  }
  const { flags } = tail.value;
  if (flags.has("read") && flags.has("unread")) {
    return err(OutlookArgsErrors.modesConflict({ flags: ["--read", "--unread"], usage }));
  }
  if (!flags.has("read") && !flags.has("unread")) {
    return err(OutlookArgsErrors.flagMissing({ flag: "--read", message: "give --read or --unread", usage }));
  }
  return ok({ ...changeCommon(tail.value), ids: [id.value], request: { kind: "mark", read: flags.has("read") } });
}

/**
 * Parse the `outlook archive` tail: one or more leading ids, deduplicated in order, then flags.
 *
 * @param rest the argv tail after `outlook archive`
 * @returns the request, or why it was refused
 */
export function parseOutlookArchiveArgs({ rest }: { rest: readonly string[] }): Parsed<OutlookChangeArgs> {
  const usage = OUTLOOK_ARCHIVE_USAGE;
  const firstFlag = rest.findIndex((token) => token.startsWith("-"));
  const leading = firstFlag === -1 ? rest : rest.slice(0, firstFlag);
  const ids = [...new Set(leading)];
  if (ids.length === 0) {
    return err(OutlookArgsErrors.argumentMissing({ name: "<message-id>", usage }));
  }
  if (ids.length > MAX_OUTLOOK_ARCHIVE_IDS) {
    const got = String(ids.length);
    const message = `at most ${String(MAX_OUTLOOK_ARCHIVE_IDS)} ids per call (got ${got}); split the set`;
    return err(OutlookArgsErrors.invalidValue({ flag: "<message-id>", got, message, usage }));
  }
  const tail = flagTail({
    boolean: ["dry-run", "restore", "thread"],
    rest: rest.slice(leading.length),
    usage,
    value: [],
  });
  if (tail.isErr()) {
    return err(tail.error);
  }
  return ok({
    ...changeCommon(tail.value),
    ids,
    request: { kind: "archive", restore: tail.value.flags.has("restore") },
  });
}

/**
 * Parse the `outlook draft` tail. `--form` is required; `-` is kept as-is for the shell to read stdin.
 *
 * @param rest the argv tail after `outlook draft`
 * @returns the request, or why it was refused
 */
export function parseOutlookDraftArgs({ rest }: { rest: readonly string[] }): Parsed<OutlookDraftArgs> {
  const usage = OUTLOOK_DRAFT_USAGE;
  const tail = flagTail({ boolean: ["dry-run"], rest, usage, value: ["form", "reply-to"] });
  if (tail.isErr()) {
    return err(tail.error);
  }
  const { flags, values } = tail.value;
  const formSource = values["form"];
  if (formSource === undefined) {
    const message = "--form <json|-> is required: the message as JSON, or `-` to read it from stdin";
    return err(OutlookArgsErrors.flagMissing({ flag: "--form", message, usage }));
  }
  return ok({
    dryRun: flags.has("dry-run"),
    formSource,
    home: values["home"],
    json: flags.has("json"),
    replyTo: values["reply-to"],
  });
}

/**
 * Parse the `outlook send` tail: one draft id, then flags. There is no `--dry-run`: a send with no `--approve`
 * IS the preview, and goes through the door to be recorded as refused.
 *
 * @param rest the argv tail after `outlook send`
 * @returns the request, or why it was refused
 */
export function parseOutlookSendArgs({ rest }: { rest: readonly string[] }): Parsed<OutlookSendArgs> {
  const usage = OUTLOOK_SEND_USAGE;
  const id = leadingId({ name: "<draft-id>", rest, usage });
  if (id.isErr()) {
    return err(id.error);
  }
  const tail = flagTail({ boolean: [], rest: rest.slice(1), usage, value: ["approve"] });
  if (tail.isErr()) {
    return err(tail.error);
  }
  const { flags, values } = tail.value;
  return ok({ approve: values["approve"], draftId: id.value, home: values["home"], json: flags.has("json") });
}
