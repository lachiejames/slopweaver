/**
 * Raw `conversations.replies` rows → the visible thread. Pure and total: every row either projects or the
 * whole read fails.
 *
 * **Why failure rather than skipping.** The corpus shapers drop a malformed row and carry on
 * (`corpus/slack/fetch.ts`), which is right for a best-effort crawl and wrong here: this verb's contract is
 * that what it prints IS the thread. One unreadable row means the output is a subset, and a subset that
 * does not say so is the defect class this repo pays for most often (constraint 2, `docs/constraints/hard.md`). So an unprojectable
 * row, a duplicate `ts`, or a row belonging to another thread aborts the read.
 *
 * Mentions are left as raw `<@U123>` tokens on purpose. `corpus/slack/project.ts` rewrites an unresolved id
 * to a generic `@user`, which is fine for corpus normalisation and is information loss here — the model can
 * reason about an id, but a lossy `@user` is unrecoverable.
 */
import { optStr as optionalString } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { slackTsToIso } from "../../lib/slackTs.js";
import { type SlackProjectionError, SlackProjectionErrors } from "./errors.js";
import { blockFileRefId, slackFileUrls } from "./fileUrls.js";
import type { SlackThreadTarget } from "./permalink.js";
import type { ProjectedSlackThread, VisibleSlackFile, VisibleSlackMessage, VisibleSlackReaction } from "./types.js";

/** A finite number field, or undefined. */
function optionalNumber({ value }: { value: unknown }): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** An array field, or an empty array — Slack omits these keys entirely when unused. */
function arrayOf({ value }: { value: unknown }): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * An array field carrying VISIBLE CONTENT, read strictly.
 *
 * `arrayOf` coerces anything non-array to `[]`, which is fine for a field whose absence means "none" and
 * catastrophic for one whose presence means "there is content here": a `files` value that arrived as an
 * object rather than an array would be coerced away, and the attachment would then be missing from
 * `files`, `skippedFiles` and `limitations` at once. Absent still means empty; present-but-wrong-shaped is
 * a failure, because the one thing we must never do is silently discard content we were given.
 *
 * @param value the raw field
 * @param field the field name, for the error
 * @returns the array, or `err` when the field is present in an unreadable shape
 */
function strictArray({
  value,
  field,
}: {
  value: unknown;
  field: string;
}): Result<readonly unknown[], SlackProjectionError> {
  // ABSENT means none. Anything else present — including an explicit `null` — is a shape this code does
  // not understand, and guessing "probably empty" is how content goes missing quietly.
  //
  // Measured before choosing to be this strict, because over-strictness would hard-fail real threads:
  // across well over a hundred thousand real messages in a real corpus, `files`/`blocks`/`attachments` are ALWAYS arrays
  // when the key is present. Zero nulls, zero other shapes. Slack omits rather than nulls, so refusing a
  // null costs nothing real and keeps this function's rule exactly what its name says.
  if (value === undefined) {
    return ok([]);
  }
  if (!Array.isArray(value)) {
    return err(SlackProjectionErrors.nonArrayField({ field }));
  }
  return ok(value);
}

/**
 * The permalink for one message. Unlike the corpus's `permalinkFor`, a REPLY carries `thread_ts`, so the
 * emitted link round-trips back through this module's parser to the same thread rather than to a
 * non-existent one.
 *
 * @param target the thread being read
 * @param ts the message timestamp
 * @returns the canonical Slack permalink
 */
function permalinkFor({ target, ts }: { target: SlackThreadTarget; ts: string }): string {
  const base = `${target.workspace}/archives/${target.channel}/p${ts.replace(".", "")}`;
  return ts === target.threadTs ? base : `${base}?thread_ts=${target.threadTs}&cid=${target.channel}`;
}

/**
 * Project one Slack file object, keeping the download URL for the fetch stage.
 *
 * An entry without a usable `id` is a FAILURE, not something to drop. Returning `undefined` and filtering
 * it away is how an attachment disappears from `files`, `skippedFiles` and `limitations` all at once —
 * a message that reads as having no attachment when it has one. That is the same silent-loss class this
 * module refuses everywhere else, and it is worse here because nothing in the output hints at it.
 *
 * Exported because `files.info` returns the SAME file shape, and a file discovered through Block Kit must
 * not end up with a different notion of "external", "tombstone" or "download URL" from its top-level
 * sibling. One projector, one set of rules.
 *
 * @param raw the raw file entry
 * @returns the projected file, or `err` when the entry cannot be accounted for
 */
export function projectSlackFile({ raw }: { raw: unknown }): Result<VisibleSlackFile, SlackProjectionError> {
  if (!isRecord(raw)) {
    return err(SlackProjectionErrors.nonObjectFileEntry());
  }
  const id = optionalString({ value: raw["id"] });
  if (id === undefined) {
    return err(SlackProjectionErrors.fileMissingId());
  }
  const externalType = optionalString({ value: raw["external_type"] });
  const fileAccess = optionalString({ value: raw["file_access"] });
  const filetype = optionalString({ value: raw["filetype"] });
  const mimetype = optionalString({ value: raw["mimetype"] });
  const mode = optionalString({ value: raw["mode"] });
  const name = optionalString({ value: raw["name"] });
  const permalink = optionalString({ value: raw["permalink"] });
  const size = optionalNumber({ value: raw["size"] });
  return ok({
    id,
    isExternal: raw["is_external"] === true,
    ...(externalType !== undefined ? { externalType } : {}),
    ...(fileAccess !== undefined ? { fileAccess } : {}),
    ...(filetype !== undefined ? { filetype } : {}),
    ...(mimetype !== undefined ? { mimetype } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(permalink !== undefined ? { permalink } : {}),
    ...(size !== undefined ? { size } : {}),
    ...slackFileUrls({ raw }),
  });
}

/**
 * Project every attachment on a message, failing the read if any one of them cannot be accounted for.
 *
 * @param raw the message's `files` value
 * @returns every projected attachment, or `err` naming the first unaccountable one
 */
function projectFiles({ raw }: { raw: unknown }): Result<readonly VisibleSlackFile[], SlackProjectionError> {
  const entries = strictArray({ field: "files", value: raw });
  if (entries.isErr()) {
    return err(entries.error);
  }
  const files: VisibleSlackFile[] = [];
  for (const entry of entries.value) {
    const projected = projectSlackFile({ raw: entry });
    if (projected.isErr()) {
      return err(projected.error);
    }
    files.push(projected.value);
  }
  return ok(files);
}

/**
 * Every visible-content field of one message, read strictly. `blocks` and `attachments` get the same
 * treatment as `files` because they carry the same risk: many app and bot messages leave `text` empty and
 * put everything a person sees in there, so coercing a malformed one to `[]` loses the entire message body
 * while the message still reads as successfully projected.
 *
 * @param raw the raw message row
 * @returns the three content arrays, or `err` if any is present in an unreadable shape
 */
function visibleContentOf({ raw }: { raw: Record<string, unknown> }): Result<
  {
    files: readonly VisibleSlackFile[];
    blocks: readonly unknown[];
    attachments: readonly unknown[];
    text: string;
  },
  SlackProjectionError
> {
  // Absent is legitimate and common — measured at a few percent of well over a hundred thousand real
  // messages, which is why absent stays "". Present-but-not-a-string is a shape this code cannot read, and
  // coercing it to "" would silently blank a message body. Measured: `text` is a string in every other one.
  const rawText = raw["text"];
  let text = "";
  if (rawText !== undefined) {
    if (typeof rawText !== "string") {
      return err(SlackProjectionErrors.nonStringText());
    }
    text = rawText;
  }
  const files = projectFiles({ raw: raw["files"] });
  if (files.isErr()) {
    return err(files.error);
  }
  const blocks = strictArray({ field: "blocks", value: raw["blocks"] });
  if (blocks.isErr()) {
    return err(blocks.error);
  }
  const attachments = strictArray({ field: "attachments", value: raw["attachments"] });
  if (attachments.isErr()) {
    return err(attachments.error);
  }
  return ok({
    attachments: attachments.value,
    blocks: blocks.value,
    files: files.value,
    text,
  });
}

/**
 * Every file id reachable inside Block Kit. An `image` block's `slack_file`, or a rich-text `file` element,
 * may reference a file instead of listing it in the message's top-level `files`, so this is a SECOND channel
 * an attachment can arrive through — measured at a handful of `slack_file` ids across well over a hundred thousand real messages, none of
 * which were also in `files`.
 *
 * @param node the blocks/attachments subtree
 * @param out the accumulating id set
 */
function collectSlackFileRefs({ node, out }: { node: unknown; out: Set<string> }): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectSlackFileRefs({ node: child, out });
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  const id = blockFileRefId({ node });
  if (id !== undefined) {
    out.add(id);
  }
  for (const child of Object.values(node)) {
    collectSlackFileRefs({ node: child, out });
  }
}

/** Project the reaction list, preserving who reacted. */
function projectReactions({ raw }: { raw: unknown }): readonly VisibleSlackReaction[] {
  const out: VisibleSlackReaction[] = [];
  for (const entry of arrayOf({ value: raw })) {
    if (!isRecord(entry)) {
      continue;
    }
    const name = optionalString({ value: entry["name"] });
    if (name === undefined) {
      continue;
    }
    const users = arrayOf({ value: entry["users"] }).filter((u): u is string => typeof u === "string");
    out.push({ count: reactionCount({ entry, users }), name, userIds: users });
  }
  return out;
}

/** How many reacted: Slack's own `count`, or — on a reaction row that omits it — how many reactors it lists. */
function reactionCount({ entry, users }: { entry: Record<string, unknown>; users: readonly string[] }): number {
  const count = optionalNumber({ value: entry["count"] });
  if (count === undefined) {
    return users.length;
  }
  return count;
}

/** The thread a row belongs to: Slack omits `thread_ts` on a message outside any thread, which is its own. */
function rowThreadTs({ raw, ts }: { raw: Record<string, unknown>; ts: string }): string {
  const threadTs = optionalString({ value: raw["thread_ts"] });
  if (threadTs === undefined) {
    return ts;
  }
  return threadTs;
}

/** The edit timestamp, when Slack reports one. */
function editedTsOf({ raw }: { raw: Record<string, unknown> }): string | undefined {
  const edited = raw["edited"];
  return isRecord(edited) ? optionalString({ value: edited["ts"] }) : undefined;
}

/**
 * Project one raw message row into its visible form.
 *
 * @param raw the row as `conversations.replies` returned it
 * @param target the thread being read
 * @returns the visible message, or `err` naming why the row is unprojectable
 */
export function projectSlackMessage({
  raw,
  target,
}: {
  raw: unknown;
  target: SlackThreadTarget;
}): Result<VisibleSlackMessage, SlackProjectionError> {
  if (!isRecord(raw)) {
    return err(SlackProjectionErrors.nonObjectMessageRow());
  }
  const ts = optionalString({ value: raw["ts"] });
  if (ts === undefined) {
    return err(SlackProjectionErrors.messageMissingTs());
  }
  // Derived, never hand-converted — `../../lib/slackTs.ts` says why that is a rule rather than a habit. A
  // `ts` that names no instant REFUSES here instead of emitting a blank `tsIso` beside a real message.
  const tsIso = slackTsToIso({ ts });
  if (tsIso === undefined) {
    return err(SlackProjectionErrors.unusableTs({ ts }));
  }
  const rowThread = rowThreadTs({ raw, ts });
  if (rowThread !== target.threadTs) {
    return err(SlackProjectionErrors.wrongThread({ expectedThreadTs: target.threadTs, rowThreadTs: rowThread, ts }));
  }
  const content = visibleContentOf({ raw });
  if (content.isErr()) {
    return err(content.error);
  }
  const { files, blocks, attachments, text } = content.value;
  const editedTs = editedTsOf({ raw });
  // An edit marker that names no instant is not worth refusing a whole message over — Slack's own field,
  // not this read's identity — so the derived half is simply absent where the raw half is unusable.
  const editedTsIso = editedTs === undefined ? undefined : slackTsToIso({ ts: editedTs });
  const subtype = optionalString({ value: raw["subtype"] });
  const refs = new Set<string>();
  collectSlackFileRefs({ node: blocks, out: refs });
  collectSlackFileRefs({ node: attachments, out: refs });
  for (const f of files) {
    refs.delete(f.id);
  }
  return ok({
    attachments,
    author: authorOf({ raw }),
    blockFileRefs: [...refs],
    blocks,
    files,
    permalink: permalinkFor({ target, ts }),
    reactions: projectReactions({ raw: raw["reactions"] }),
    relation: ts === target.threadTs ? "parent" : "reply",
    text,
    threadTs: target.threadTs,
    ts,
    tsIso,
    ...(editedTs !== undefined ? { editedTs } : {}),
    ...(editedTsIso === undefined ? {} : { editedTsIso }),
    ...(subtype !== undefined ? { subtype } : {}),
  });
}

/**
 * Project the rows of one `conversations.history` page — a conversation's top level, not a thread — oldest first.
 * Each row is read against its OWN thread (its `thread_ts`, else itself), so a thread root and a reply also sent
 * to the conversation both project, with the permalink a reader opens.
 *
 * @param rawMessages the rows, newest first as Slack returns them
 * @param channel the conversation id
 * @param workspace the HTTPS workspace origin permalinks are built on
 * @returns the messages that project, oldest first, and how many rows did not — counted, so a caller can say a
 *   message went unread rather than lose it silently
 */
export function projectTopLevelMessages({
  rawMessages,
  channel,
  workspace,
}: {
  rawMessages: readonly unknown[];
  channel: string;
  workspace: string;
}): { readonly messages: readonly VisibleSlackMessage[]; readonly unreadable: number } {
  const messages: VisibleSlackMessage[] = [];
  let unreadable = 0;
  for (const raw of rawMessages.toReversed()) {
    const ts = isRecord(raw) ? optionalString({ value: raw["ts"] }) : undefined;
    if (!isRecord(raw) || ts === undefined) {
      unreadable += 1;
      continue;
    }
    // A row with no `thread_ts` is its own thread's root.
    let threadTs = ts;
    const statedThreadTs = optionalString({ value: raw["thread_ts"] });
    if (statedThreadTs !== undefined) {
      threadTs = statedThreadTs;
    }
    const target = { addressedReply: false, addressedTs: ts, channel, threadTs, workspace };
    const projected = projectSlackMessage({ raw, target });
    if (projected.isOk()) {
      messages.push(projected.value);
    } else {
      unreadable += 1;
    }
  }
  return { messages, unreadable };
}

/** Who wrote it — user, bot, or an app-supplied username. */
function authorOf({ raw }: { raw: Record<string, unknown> }): VisibleSlackMessage["author"] {
  const botId = optionalString({ value: raw["bot_id"] });
  const userId = optionalString({ value: raw["user"] });
  const username = optionalString({ value: raw["username"] });
  return {
    ...(botId !== undefined ? { botId } : {}),
    ...(userId !== undefined ? { userId } : {}),
    ...(username !== undefined ? { username } : {}),
  };
}

/**
 * Project every row of a fetched thread, refusing anything incomplete or inconsistent.
 *
 * @param rawMessages the rows across every page, in Slack's order
 * @param target the thread being read
 * @returns the projected thread, or `err` when it cannot be projected in full
 */
export function projectSlackThread({
  rawMessages,
  target,
}: {
  rawMessages: readonly unknown[];
  target: SlackThreadTarget;
}): Result<ProjectedSlackThread, SlackProjectionError> {
  const messages: VisibleSlackMessage[] = [];
  const seen = new Set<string>();
  for (const raw of rawMessages) {
    const projected = projectSlackMessage({ raw, target });
    if (projected.isErr()) {
      return err(projected.error);
    }
    if (seen.has(projected.value.ts)) {
      // The PARENT repeating is Slack's pagination protocol, not corruption: `conversations.replies`
      // returns the thread root as `messages[0]` of EVERY page. VERIFIED against a real 311-message
      // thread — page 1 came back as parent + 200 replies, page 2 as the same parent + 110 more. Failing
      // on it made every thread over one page (>200 replies) completely unreadable.
      //
      // A repeated REPLY is still refused. Nothing legitimate produces one, so it stays a hard error
      // rather than being deduped away with the parent.
      if (projected.value.ts === target.threadTs) {
        continue;
      }
      return err(SlackProjectionErrors.duplicateMessage({ ts: projected.value.ts }));
    }
    seen.add(projected.value.ts);
    messages.push(projected.value);
  }
  if (!seen.has(target.threadTs)) {
    return err(SlackProjectionErrors.missingParent({ threadTs: target.threadTs }));
  }
  return ok({ messages, replyCount: messages.length - 1 });
}
