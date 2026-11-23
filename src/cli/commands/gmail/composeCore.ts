/**
 * PURE argument handling for the two outbound `gmail` verbs — `draft` and `send`.
 *
 * Separate from `core.ts` for the same reason `modifyRun.ts` is separate from `readRun.ts`: these two verbs
 * are the only ones that can put mail in front of another person, and keeping their parsing in its own file
 * means the refusals that protect that path are read together rather than found scattered among seven
 * other verbs' flags.
 *
 * As with every other `gmail` verb, a malformed invocation is refused here — before a credential is read or
 * a socket is opened — which is what lets both verbs declare `parseRejectIsIoFree`.
 */
import { MAIL_DIGEST_PATTERN } from "../../../handover/mailActionPreview.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type GmailArgsError, GmailArgsErrors } from "./errors.js";

/** `--form -` reads the form from stdin. The same sentinel the Slack outbound lane uses. */
export const STDIN_SENTINEL = "-";

/**
 * A parsed `gmail draft` invocation.
 *
 * `formSource` is the raw `--form` value, NOT the form: `-` means "read stdin", which is I/O and therefore
 * the shell's job rather than the parser's.
 *
 * @internal — the declared shape of `parseGmailDraftArgs`'s success value; no caller names it.
 */
export interface GmailDraftArgs {
  readonly home: string | undefined;
  /** The raw `--form` value, or `undefined` exactly when {@link GmailDraftArgs.board} is set. */
  readonly formSource: string | undefined;
  /** The board row whose recorded mail action is the form, and the digest its preview printed. */
  readonly board: { readonly slug: string; readonly expect: string } | undefined;
  readonly replyToId: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
}

/**
 * A parsed `gmail send` invocation.
 *
 * @internal — the declared shape of `parseGmailSendArgs`'s success value; no caller names it.
 */
export interface GmailSendArgs {
  readonly home: string | undefined;
  readonly draftId: string;
  /** The digest supplied with `--approve`, absent when the caller supplied none. */
  readonly approve: string | undefined;
  readonly json: boolean;
}

/** `gmail draft` usage. */
const DRAFT_USAGE =
  "usage: slopweaver gmail draft (--form <json|-> [--reply-to <message-id>] | --board <slug> --expect <digest>) " +
  "[--dry-run] [--json] [--home <dir>]\n" +
  "  Composes a message and stores it as a draft in your own mailbox. Nothing is sent\n" +
  "  --form     the message as JSON: { to, cc, bcc, subject, body }. `-` reads it from stdin\n" +
  "  --board    draft the MAIL action a board row's open ask offers, instead of a form — a reply when it records one\n" +
  "  --expect   the digest its console preview printed; a row whose mail changed since is refused\n" +
  "  --reply-to compose as a reply to this message id, inheriting its thread and subject\n" +
  "  --dry-run  print the composed message and store nothing\n" +
  "  Prefer `--form -`: a body on a command line is a body the shell rewrites";

/** `gmail send` usage. */
const SEND_USAGE =
  "usage: slopweaver gmail send <draft-id> [--approve <digest>] [--json] [--home <dir>]\n" +
  "  Sends an existing draft. THIS PUTS MAIL IN FRONT OF ANOTHER PERSON and cannot be undone\n" +
  "  --approve the digest printed by the unapproved run, which covers that exact content\n" +
  "  Run it with no --approve first: that prints the message as Gmail holds it, plus its digest,\n" +
  "  and sends nothing. There is no separate dry-run mode: the unapproved run IS the preview";

/** Read the optional `--home` value out of a parsed tail. */
function homeOf({ values }: { values: Readonly<Record<string, string>> }): string | undefined {
  return values["home"];
}

/**
 * Parse the `gmail draft` tail.
 *
 * @param rest the argv tail after `gmail draft`
 * @returns the validated request, or every reason it was refused
 */
export function parseGmailDraftArgs({ rest }: { rest: readonly string[] }): Result<GmailDraftArgs, GmailArgsError> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["dry-run", "json"], value: ["board", "expect", "form", "home", "reply-to"] },
  });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: DRAFT_USAGE }));
  }
  const common = {
    dryRun: parsed.value.flags.has("dry-run"),
    home: homeOf({ values: parsed.value.values }),
    json: parsed.value.flags.has("json"),
  };
  const formSource = parsed.value.values["form"];
  const slug = parsed.value.values["board"];
  const expect = parsed.value.values["expect"];
  if (slug !== undefined || expect !== undefined) {
    return boardDraftArgs({ common, expect, formSource, replyToId: parsed.value.values["reply-to"], slug });
  }
  if (formSource === undefined) {
    return err(GmailArgsErrors.formMissing({ usage: DRAFT_USAGE }));
  }
  return ok({ ...common, board: undefined, formSource, replyToId: parsed.value.values["reply-to"] });
}

/**
 * The `--board` spelling of `gmail draft`, refusing every flag that would make the form come from two places.
 *
 * @returns the board request, or every reason it was refused
 */
function boardDraftArgs({
  common,
  slug,
  expect,
  formSource,
  replyToId,
}: {
  common: { dryRun: boolean; home: string | undefined; json: boolean };
  slug: string | undefined;
  expect: string | undefined;
  formSource: string | undefined;
  replyToId: string | undefined;
}): Result<GmailDraftArgs, GmailArgsError> {
  const problems: string[] = [];
  if (slug === undefined) {
    problems.push("--expect names a previewed mail, so it needs --board <slug> beside it");
  }
  if (expect === undefined) {
    problems.push("--board needs --expect <digest>: the digest the preview printed, so a changed mail is refused");
  }
  if (expect !== undefined && !MAIL_DIGEST_PATTERN.test(expect)) {
    problems.push(`--expect ${expect} is not a mail digest (sixteen lowercase hex characters)`);
  }
  if (formSource !== undefined) {
    problems.push("--board and --form both name the message; the row's recorded mail IS the form");
  }
  if (replyToId !== undefined) {
    problems.push(
      "--board drafts the recorded mail exactly as previewed, a reply only when the row recorded one; --reply-to beside it would draft a mail nobody previewed",
    );
  }
  if (problems.length > 0 || slug === undefined || expect === undefined) {
    return err(GmailArgsErrors.boardArgsInvalid({ reasons: problems, usage: DRAFT_USAGE }));
  }
  return ok({ ...common, board: { expect, slug }, formSource: undefined, replyToId: undefined });
}

/**
 * Parse the `gmail send` tail: one leading positional draft id, then flags.
 *
 * There is deliberately no `--dry-run`. A send with no `--approve` already prints the message and sends
 * nothing, so a second way to say the same thing would only invite the belief that the FIRST way sends —
 * and the difference matters: an unapproved send goes through the door and is recorded as refused, which is
 * a fact worth having about a surface that reaches other people.
 *
 * @param rest the argv tail after `gmail send`
 * @returns the validated request, or every reason it was refused
 */
export function parseGmailSendArgs({ rest }: { rest: readonly string[] }): Result<GmailSendArgs, GmailArgsError> {
  const draftId = rest[0];
  if (draftId === undefined || draftId.startsWith("-")) {
    return err(GmailArgsErrors.argumentMissing({ name: "<draft-id>", usage: SEND_USAGE }));
  }
  const parsed = parseFlagTail({ rest: rest.slice(1), spec: { boolean: ["json"], value: ["approve", "home"] } });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: SEND_USAGE }));
  }
  return ok({
    approve: parsed.value.values["approve"],
    draftId,
    home: homeOf({ values: parsed.value.values }),
    json: parsed.value.flags.has("json"),
  });
}
