/**
 * `slopweaver linear comment create` — the effectful shell. Every decision lives in `./commentCore.ts`; this
 * file resolves the home and token, routes the effect through the admit door, and performs the create.
 *
 * Create-only, so there is no ownership gate and no read-before-write safety check: reserve → mutate → read
 * back → confirm → report, the same at-most-once shape `./run.ts` and `./milestoneRun.ts` both prove. A
 * comment is never updated by this door — see the module doc on `../../../corpus/linear/writeCreateOnly.ts`'s
 * `commentApi` for why editing a message someone has already been notified about is not offered.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { LinearWriteApi } from "../../../corpus/linear/write.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { linkifyCommentArtifact } from "../../../outbound/linear/bareRefLinks.js";
import { confirmAppend, releaseAppendReservation, reserveAppend } from "../../../outbound/linear/commentLedger.js";
import type { LinearCommentForm } from "../../../outbound/linear/commentTypes.js";
import { linearMentionRefusals, staleLinearMentionRefusals } from "../../../outbound/linear/mentionIndex.js";
import { mentionKeysOfComment, rewriteCommentMentions } from "../../../outbound/linear/mentionRewrite.js";
import { settledBeforeWire } from "../../../outbound/linear/sendFailure.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import {
  commentDoorRequestFor,
  commentDryRunLines,
  commentInputFor,
  commentIntentId,
  commentOutcomeLines,
  type LinearCommentArgs,
  type LinearCommentOutcome,
  parseLinearCommentArgs,
  parseLinearCommentForm,
  type ResolvedCommentTarget,
  resolvedCommentIntentId,
} from "./commentCore.js";
import { type LinearCommentWriteDeps, productionLinearCommentWriteDeps } from "./commentDeps.js";
import { commentAboveFoldRefused, commentBareRefRefused } from "./commentGates.js";
import { dryRunAnchor, resolveTarget, targetRefusalCode } from "./commentTarget.js";
import { linearVerbErrorLines } from "./errors.js";

/** Same offset `./run.ts` documents: node, script, noun, verb. */
const VERB_ARG_OFFSET = 4;

/** Print each line to stderr and return the code. */
function refuse({
  deps,
  lines,
  code,
}: {
  deps: LinearCommentWriteDeps;
  lines: readonly string[];
  code: number;
}): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/** Everything the effect phase needs, once the cheap checks have passed. */
interface CommentWriteContext {
  readonly api: LinearWriteApi;
  readonly deps: LinearCommentWriteDeps;
  readonly home: string;
  readonly id: string;
  readonly form: LinearCommentForm;
  readonly target: ResolvedCommentTarget;
}

/**
 * A mutation that returned an error. The freshly-reserved id proves a genuine create, so anything found
 * there is what we asked for — same reasoning `./issueWrite.ts`'s `afterLostResponse` applies to an issue create.
 *
 * @param ctx the write context
 * @param reason the transport error the mutation returned
 * @returns what is actually known about the write
 */
async function afterLostResponse({
  ctx,
  reason,
}: {
  ctx: CommentWriteContext;
  reason: string;
}): Promise<LinearCommentOutcome> {
  const readBack = await ctx.api.readComment({ id: ctx.id });
  if (readBack.isErr()) {
    return { kind: "indeterminate", reason };
  }
  const found = readBack._unsafeUnwrap();
  if (found === undefined) {
    return { kind: "failed", reason };
  }
  confirmAppend({
    home: ctx.home,
    id: ctx.id,
    kind: "linear-comments",
    nowIso: ctx.deps.nowIso(),
    subject: ctx.target.id,
  });
  return { comment: found, kind: "landed", reason };
}

/** Reserve, mutate, read back, confirm. Runs ONLY when the door passed. */
async function performWrite({ ctx }: { ctx: CommentWriteContext }): Promise<LinearCommentOutcome> {
  const reservedIso = ctx.deps.nowIso();
  const claim = reserveAppend({
    home: ctx.home,
    id: ctx.id,
    kind: "linear-comments",
    nowIso: reservedIso,
    subject: ctx.target.id,
  });
  if (claim.kind === "taken") {
    return { kind: "duplicate", reservedIso: claim.record.reservedIso };
  }
  const mutation = await ctx.api.createComment({
    id: ctx.id,
    input: commentInputFor({ form: ctx.form, target: ctx.target }),
  });
  // Refused before the wire: nothing was sent, so this create's own reservation is released for the retry.
  const release = () => releaseAppendReservation({ home: ctx.home, id: ctx.id, kind: "linear-comments", reservedIso });
  if (mutation.isErr() && settledBeforeWire({ error: mutation.error, release })) {
    return { kind: "failed", reason: mutation.error.message };
  }
  if (mutation.isErr()) {
    return afterLostResponse({ ctx, reason: mutation._unsafeUnwrapErr().message });
  }
  const written = mutation._unsafeUnwrap();
  // The mutation's own response is not proof — `CommentPayload.comment` is `Maybe<Comment>`, the same shape
  // that lets an issue create answer success with nothing — so the comment is established by reading it back.
  // The read-back is also the only source of the comment's URL: the SDK's payload echoes `comment { id }`.
  const readBack = await ctx.api.readComment({ id: ctx.id });
  if (readBack.isErr() || readBack._unsafeUnwrap() === undefined) {
    return { comment: written, kind: "unconfirmed" };
  }
  const found = readBack._unsafeUnwrap()!;
  confirmAppend({
    home: ctx.home,
    id: ctx.id,
    kind: "linear-comments",
    nowIso: ctx.deps.nowIso(),
    subject: ctx.target.id,
  });
  return { comment: found, kind: "written" };
}

/** The exit code for an outcome. */
function codeFor({ outcome }: { outcome: LinearCommentOutcome }): number {
  if (outcome.kind === "written" || outcome.kind === "landed") {
    return EXIT_OK;
  }
  return outcome.kind === "failed" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
}

/**
 * The mention gate, which runs BEFORE the door exactly as `./run.ts`'s assignee gate does, so a body naming
 * someone the roster cannot address costs no audit record and no reservation. The roster's own refusal (the
 * store unreachable, its row unreadable) is a different failure from a key that will not resolve, so it
 * carries its own exit code: an error, never the expected-empty a refused mention is.
 */
async function mentionedForm({
  args,
  deps,
  form,
  home,
}: {
  args: LinearCommentArgs;
  deps: LinearCommentWriteDeps;
  form: LinearCommentForm;
  home: string;
}): Promise<Result<LinearCommentForm, { readonly code: number; readonly lines: readonly string[] }>> {
  const keys = mentionKeysOfComment({ artifact: form.artifact });
  const resolved = await deps.resolveMentions({ home, keys, verified: args.mentionIds });
  if (resolved.isErr()) {
    return err({ code: EXIT_ERROR, lines: [resolved.error.message] });
  }
  const resolution = resolved.value;
  const refusals = [
    ...linearMentionRefusals({ keys, resolution }),
    ...staleLinearMentionRefusals({ keys, resolution }),
  ];
  if (refusals.length > 0) {
    return err({ code: EXIT_EXPECTED_EMPTY, lines: refusals });
  }
  return ok({ ...form, artifact: rewriteCommentMentions({ artifact: form.artifact, resolution }) });
}

/** The effect phase: token, door, write. */
async function runLive({
  args,
  deps,
  form,
  intentForm,
}: {
  args: LinearCommentArgs;
  deps: LinearCommentWriteDeps;
  form: LinearCommentForm;
  intentForm: LinearCommentForm;
}): Promise<number> {
  const home = resolveHome({ named: args.home });
  const token = deps.resolveToken({ home });
  if (token === undefined) {
    return refuse({
      code: EXIT_EXPECTED_EMPTY,
      deps,
      lines: [`no Linear token for this home. Set LINEAR_API_KEY, or write ${home}/secrets/linear-token`],
    });
  }
  // A document is read BEFORE the mention gate and the door, for the same reason the mention gate runs before
  // the door: a comment that cannot land costs no audit record and no reservation.
  const target = await resolveTarget({ deps, form, token });
  if (target.isErr()) {
    return refuse({ code: targetRefusalCode({ error: target.error }), deps, lines: [target.error.message] });
  }
  const id = resolvedCommentIntentId({ form: intentForm, target: target.value });
  const mentioned = await mentionedForm({ args, deps, form, home });
  if (mentioned.isErr()) {
    return refuse({ code: mentioned.error.code, deps, lines: mentioned.error.lines });
  }
  const ctx: CommentWriteContext = {
    api: deps.makeApi({ home, token }),
    deps,
    form: mentioned.value,
    home,
    id,
    target: target.value,
  };
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    // Passed EXPLICITLY, for the reason `./run.ts` records: omitting it writes the audit record to the
    // default home while the comment ledger goes to `--home`.
    home,
    ledger: deps.doorLedger,
    perform: () => performWrite({ ctx }),
    request: commentDoorRequestFor({ destination: target.value, home, id }),
  });
  if (!routed.performed) {
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      deps,
      lines: [...notPerformedLines({ command: "slopweaver linear comment", through: routed })],
    });
  }
  for (const line of commentOutcomeLines({ outcome: routed.result })) {
    deps.out(line);
  }
  return codeFor({ outcome: routed.result });
}

/**
 * The dry run: stops before every effect. Nothing recorded, nothing reserved, nothing sent — and the mentions
 * are previewed against the rosters as they STAND rather than through the just-in-time refresh the live path
 * performs, because that refresh writes silver artifacts and a preview leaves no trace. The gates report LAST,
 * under the preview they are judging; a roster store that cannot be read refuses before any preview prints.
 */
async function runCommentDryRun({
  args,
  deps,
  home,
  id,
  intentForm,
  issues,
  linkedForm,
}: {
  args: LinearCommentArgs;
  deps: LinearCommentWriteDeps;
  home: string;
  id: string;
  intentForm: LinearCommentForm;
  issues: Parameters<typeof commentBareRefRefused>[0]["issues"];
  linkedForm: LinearCommentForm;
}): Promise<number> {
  const keys = mentionKeysOfComment({ artifact: linkedForm.artifact });
  const previewed = await deps.previewMentions({ home, keys, verified: args.mentionIds });
  if (previewed.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [previewed.error.message] });
  }
  const preview = previewed.value;
  const previewForm: LinearCommentForm = {
    ...linkedForm,
    artifact: rewriteCommentMentions({ artifact: linkedForm.artifact, resolution: preview }),
  };
  const anchor = await dryRunAnchor({ deps, form: linkedForm, home, id, intentForm });
  for (const line of commentDryRunLines({ anchor: anchor.line, form: previewForm, id: anchor.id, mentions: keys })) {
    deps.out(line);
  }
  const mentionRefusals = linearMentionRefusals({ keys, resolution: preview });
  for (const line of mentionRefusals) {
    deps.out(line);
  }
  const aboveFold = await commentAboveFoldRefused({ args, artifact: linkedForm.artifact, deps });
  const bareRefs = commentBareRefRefused({ deps, dryRun: args.dryRun, home, issues });
  return aboveFold || bareRefs || mentionRefusals.length > 0 || anchor.refused ? EXIT_ERROR : EXIT_OK;
}

/**
 * Run `linear comment create`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runLinearComment({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: LinearCommentWriteDeps;
}): Promise<number> {
  const parsed = parseLinearCommentArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const form = parseLinearCommentForm({ raw: deps.readForm({ source: args.formSource }) });
  if (form.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: form.error }) });
  }
  const id = commentIntentId({ form: form.value });
  // Resolve every #N/owner/repo#N/SUP-123 into a real link before anything renders — see
  // ../../bareRefDoor.ts.
  const home = resolveHome({ named: args.home });
  const linkified = linkifyCommentArtifact({
    artifact: form.value.artifact,
    context: deps.bareRefContext({ home }),
  });
  const linkedForm = { ...form.value, artifact: linkified.artifact };
  if (args.dryRun) {
    return runCommentDryRun({ args, deps, home, id, intentForm: form.value, issues: linkified.issues, linkedForm });
  }
  if (await commentAboveFoldRefused({ args, artifact: linkedForm.artifact, deps })) {
    return EXIT_ERROR;
  }
  if (commentBareRefRefused({ deps, dryRun: args.dryRun, home, issues: linkified.issues })) {
    return EXIT_ERROR;
  }
  return runLive({ args, deps, form: linkedForm, intentForm: form.value });
}

/** `slopweaver linear comment` — post one comment on a Linear issue from a typed form, through the door. */
export const linearCommentCommand = defineCommand({
  run: (argv: readonly string[]) => runLinearComment({ argv, deps: productionLinearCommentWriteDeps() }),
});
