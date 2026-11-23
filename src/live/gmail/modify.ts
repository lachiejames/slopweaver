/**
 * The two halves of every Gmail mutation, deliberately split: PLAN, which reads and decides, and APPLY,
 * which is the single call that changes a mailbox.
 *
 * ## Why the split is structural rather than tidy
 *
 * `AGENTS.md` rule 3 puts every external write through the door, and the door wraps a THUNK. If planning
 * and applying lived in one function, the thing the door wrapped would be "read the mailbox, decide, and
 * also mutate it" — so the ledger would record a decision whose artifact was assembled inside the very
 * effect being admitted, and `--dry-run` would have to be a boolean threaded through the mutation itself.
 * Split, `--dry-run` is simply the caller stopping after {@link planGmailLabelChange}, and the door wraps
 * {@link applyGmailLabelChange}, which does exactly one thing.
 *
 * ## What a plan is allowed to claim
 *
 * A plan reads current label state and narrows itself against it, so a verb can say "already archived"
 * instead of sending a request that succeeds while changing nothing. That narrowing is a MEASUREMENT with a
 * shelf life — the mailbox can move between the plan and the apply, and this repo would rather state that in
 * residue than pretend a two-call sequence is atomic. Gmail offers no compare-and-set on `modify`, so there
 * is no version of this that is race-free; there is only the honest version and the quiet one.
 *
 * Effectful only through the injected {@link GmailApi}, so both halves are unit tested with plain fakes.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { GmailApi } from "./api.js";
import type { GmailError } from "./errors.js";
import {
  type GmailLabel,
  type GmailLabelPlan,
  planLabelChange,
  planThreadLabelChange,
  rejectUnaddableLabels,
  resolveLabelRefs,
} from "./labels.js";
import { messageLabelIds } from "./omittedFields.js";
import type { GmailMessage } from "./parse.js";

/** Whether a mutation addresses one message or every message in its thread. */
export type GmailModifyScope = "message" | "thread";

/** One message's identity and label set — everything a mutation report needs, and no content. */
interface GmailLabelState {
  readonly id: string;
  readonly labelIds: readonly string[];
}

/** A decided, not-yet-sent mutation. */
export interface GmailModifyPlan {
  readonly account: string;
  readonly address: string;
  readonly scope: GmailModifyScope;
  /** What the caller's verb called this in their own words — "archive", "mark read", "label". */
  readonly intent: string;
  readonly plan: GmailLabelPlan;
  /** Label state as it was read, before anything was sent. */
  readonly before: readonly GmailLabelState[];
  /** Display name for every label id this plan mentions, so a report never shows a bare `Label_7`. */
  readonly labelNames: Readonly<Record<string, string>>;
}

/** A sent mutation, and what the mailbox reported back. */
export interface GmailModifyOutcome {
  readonly plan: GmailModifyPlan;
  /** Label state as Gmail returned it after the change. Empty when the API reported none — see residue. */
  readonly after: readonly GmailLabelState[];
  readonly residue: readonly string[];
}

/**
 * The id a mutation report prints for one message. A message state Gmail returned with no id is still
 * reported, because its labels are the evidence of what the change did; the literal `(no id)` says in the
 * report that Gmail named no message, rather than dropping the row or printing a blank.
 */
function reportedMessageId({ message }: { message: GmailMessage }): string {
  const { id } = message;
  if (id == null) {
    return "(no id)";
  }
  return id;
}

/** Reduce a raw API message to the only two fields a mutation report is allowed to carry. */
function toLabelState({ message }: { message: GmailMessage }): GmailLabelState {
  return { id: reportedMessageId({ message }), labelIds: messageLabelIds({ message }) };
}

/**
 * Index every label id this plan mentions to its display name. Every id here came out of `resolveLabelRefs`
 * over this SAME `labels` list, and `resolveLabelRef` only ever answers the `id` of an entry it found in that
 * list (by name or by id), refusing anything else — so each id has its entry, and the lookup asserts it. The
 * caller builds this index with no await between resolution and lookup, so nothing can change the list in
 * between.
 */
function nameIndex({
  labels,
  ids,
}: {
  labels: readonly GmailLabel[];
  ids: readonly string[];
}): Readonly<Record<string, string>> {
  const index: Record<string, string> = {};
  for (const id of ids) {
    index[id] = labels.find((label) => label.id === id)!.name;
  }
  return index;
}

/**
 * Read what a mutation would change, resolve the caller's label references, and narrow the plan against
 * current state. Sends nothing.
 *
 * @param api the injected Gmail seam
 * @param account the mailbox the grant bound to
 * @param address the message id, or the thread id when `scope` is `thread`
 * @param scope whether the change addresses one message or the whole thread
 * @param intent the verb's own word for what it is doing, carried into the report
 * @param addRefs label names or ids to add, exactly as the caller wrote them
 * @param removeRefs label names or ids to remove, exactly as the caller wrote them
 * @returns the decided plan, or the typed reason it could not be decided
 */
export async function planGmailLabelChange({
  api,
  account,
  address,
  scope,
  intent,
  addRefs,
  removeRefs,
}: {
  api: GmailApi;
  account: string;
  address: string;
  scope: GmailModifyScope;
  intent: string;
  addRefs: readonly string[];
  removeRefs: readonly string[];
}): Promise<Result<GmailModifyPlan, GmailError>> {
  const labels = await api.listLabels();
  if (labels.isErr()) {
    return err(labels.error);
  }
  const add = resolveLabelRefs({ labels: labels.value, refs: addRefs });
  if (add.isErr()) {
    return err(add.error);
  }
  const remove = resolveLabelRefs({ labels: labels.value, refs: removeRefs });
  if (remove.isErr()) {
    return err(remove.error);
  }
  const allowed = rejectUnaddableLabels({ addLabelIds: add.value });
  if (allowed.isErr()) {
    return err(allowed.error);
  }
  const labelNames = nameIndex({ ids: [...add.value, ...remove.value], labels: labels.value });
  const before = await readLabelState({ address, api, scope });
  if (before.isErr()) {
    return err(before.error);
  }
  const plan =
    scope === "thread"
      ? planThreadLabelChange({
          addLabelIds: add.value,
          messageLabelIds: before.value.map((state) => state.labelIds),
          removeLabelIds: remove.value,
        })
      : planLabelChange({
          addLabelIds: add.value,
          currentLabelIds: before.value[0]!.labelIds, // exactly one state: see `readLabelState`
          removeLabelIds: remove.value,
        });
  return ok({
    account,
    address,
    before: before.value,
    intent,
    labelNames,
    plan,
    scope,
  });
}

/**
 * Read current label state for whichever scope the caller addressed, as metadata only.
 *
 * A `message`-scope read is ONE `getMessage`, answered as exactly one state, so its first entry always exists;
 * {@link planGmailLabelChange} reads that entry on this invariant rather than guarding an absence that cannot
 * occur. A `thread`-scope read answers one state per message the thread returned.
 */
async function readLabelState({
  api,
  address,
  scope,
}: {
  api: GmailApi;
  address: string;
  scope: GmailModifyScope;
}): Promise<Result<readonly GmailLabelState[], GmailError>> {
  if (scope === "thread") {
    const thread = await api.getThread({ format: "metadata", id: address });
    return thread.map((messages) => messages.map((message) => toLabelState({ message })));
  }
  const message = await api.getMessage({ format: "metadata", id: address });
  return message.map((one) => [toLabelState({ message: one })]);
}

/** The residue an applied mutation owes its reader. */
function outcomeResidue({ plan, after }: { plan: GmailModifyPlan; after: readonly GmailLabelState[] }): string[] {
  const residue: string[] = [];
  if (after.length === 0) {
    residue.push(
      "the API returned no message state after the change, so the new labels below are what was ASKED for " +
        "rather than what was read back — re-read with `gmail read` to confirm",
    );
  }
  if (plan.scope === "thread") {
    residue.push(
      `every message in thread ${plan.address} was changed together; a thread's messages can start in ` +
        "different states, so this reports the thread's end state rather than per-message deltas",
    );
  } else {
    residue.push(
      "this changed ONE message; other messages in its thread are untouched and may still be unread or in " +
        "the inbox — re-run with --thread to move the whole conversation",
    );
  }
  residue.push(
    "the label state was read before the change and Gmail offers no compare-and-set, so a change made " +
      "elsewhere in between is neither detected nor reported",
  );
  return residue;
}

/**
 * Send a decided plan. This is the one call in the Gmail door that changes a mailbox, and it is what the
 * caller wraps in `throughDoor`.
 *
 * A `noop` plan is NOT sent: Gmail would accept it and report success, which would put "changed" in a report
 * and a decision in the ledger for a request that moved nothing.
 *
 * @param api the injected Gmail seam
 * @param plan the decided plan from {@link planGmailLabelChange}
 * @returns what the mailbox reported afterwards, or the typed reason the change failed
 */
export async function applyGmailLabelChange({
  api,
  plan,
}: {
  api: GmailApi;
  plan: GmailModifyPlan;
}): Promise<Result<GmailModifyOutcome, GmailError>> {
  if (plan.plan.noop) {
    return ok({ after: plan.before, plan, residue: ["nothing was sent — the mailbox is already in this state"] });
  }
  const sent =
    plan.scope === "thread"
      ? (
          await api.modifyThread({
            addLabelIds: plan.plan.addLabelIds,
            id: plan.address,
            removeLabelIds: plan.plan.removeLabelIds,
          })
        ).map((messages) => messages.map((message) => toLabelState({ message })))
      : (
          await api.modifyMessage({
            addLabelIds: plan.plan.addLabelIds,
            id: plan.address,
            removeLabelIds: plan.plan.removeLabelIds,
          })
        ).map((message) => [toLabelState({ message })]);
  if (sent.isErr()) {
    return err(sent.error);
  }
  return ok({ after: sent.value, plan, residue: outcomeResidue({ after: sent.value, plan }) });
}
