/**
 * The Outlook verbs that CHANGE a mailbox — `mark`, `category`, `archive` — as a plan computed from current
 * state, then applied one message at a time.
 *
 * Every target is resolved BEFORE the first write: the named messages, widened to their conversations under
 * `--thread`, deduplicated by immutable id. Planning is pure over what was read, so a dry run shows exactly the
 * writes a real run would make, and a message already in the wanted state is reported unchanged rather than
 * written again.
 *
 * Applying stops at the first failure and names every message it did not reach. Continuing past a failed write
 * would keep spending requests against a mailbox that just refused one (a throttle, a revoked grant), and the
 * report says exactly which messages changed either way.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { MessagePatch, OutlookApi } from "./apiCore.js";
import { type CategoryChange, nextCategories } from "./categories.js";
import { type OutlookError } from "./errors.js";
import { type OutlookMessageSummary, readOutlookThread, toSummary } from "./messages.js";

/**
 * Which verb produced a plan.
 *
 * @internal — the declared type of a plan's and an outcome's `intent`; callers read the field, never name it.
 */
export type OutlookChangeIntent = "mark" | "category" | "archive";

/**
 * One message's planned write, or that it needs none.
 *
 * @internal — the element type of `OutlookChangePlan.steps`; callers iterate the plan, never name the step.
 */
export type OutlookChangeStep =
  | { readonly kind: "patch"; readonly id: string; readonly patch: MessagePatch }
  | { readonly kind: "move"; readonly id: string; readonly destinationId: string }
  | { readonly kind: "unchanged"; readonly id: string };

/** A whole change, before anything is written. */
export interface OutlookChangePlan {
  readonly intent: OutlookChangeIntent;
  readonly thread: boolean;
  readonly steps: readonly OutlookChangeStep[];
}

/** What applying a plan did, message by message. */
export interface OutlookChangeOutcome {
  readonly intent: OutlookChangeIntent;
  readonly changed: readonly string[];
  readonly unchanged: readonly string[];
  /** The message whose write failed, and why; absent when every write landed. */
  readonly failed: { readonly id: string; readonly message: string } | undefined;
  /** Messages after a failure, which were not attempted. */
  readonly notAttempted: readonly string[];
}

/**
 * Read every target: each named message, widened to its conversation under `thread`, deduplicated by id in the
 * order first seen.
 *
 * @param ids the message ids the owner named
 * @param thread widen each to its whole conversation
 * @returns the current state of every target, or the first read that failed
 */
export async function resolveTargets({
  api,
  ids,
  thread,
}: {
  api: OutlookApi;
  ids: readonly string[];
  thread: boolean;
}): Promise<Result<readonly OutlookMessageSummary[], OutlookError>> {
  const targets = new Map<string, OutlookMessageSummary>();
  for (const id of ids) {
    const read = await api.getMessage({ id });
    if (read.isErr()) {
      return err(read.error);
    }
    const message = toSummary({ message: read.value, operation: "outlook.messages.get" });
    if (message.isErr()) {
      return err(message.error);
    }
    if (!thread) {
      targets.set(message.value.id, message.value);
      continue;
    }
    const conversation = await readOutlookThread({ api, conversationId: message.value.conversationId });
    if (conversation.isErr()) {
      return err(conversation.error);
    }
    for (const member of conversation.value) {
      targets.set(member.id, member);
    }
  }
  return ok([...targets.values()]);
}

/**
 * Plan `mark`: set `isRead` on every target not already in that state.
 *
 * @param read true to mark read, false to mark unread
 * @returns the plan
 */
export function planMark({
  targets,
  read,
  thread,
}: {
  targets: readonly OutlookMessageSummary[];
  read: boolean;
  thread: boolean;
}): OutlookChangePlan {
  return {
    intent: "mark",
    steps: targets.map((target): OutlookChangeStep =>
      target.isRead === read
        ? { id: target.id, kind: "unchanged" }
        : { id: target.id, kind: "patch", patch: { isRead: read } },
    ),
    thread,
  };
}

/**
 * Plan `category`: give every target its absolute next category list, skipping one it would not change.
 *
 * @param change the resolved additions and removals
 * @returns the plan
 */
export function planCategory({
  targets,
  change,
  thread,
}: {
  targets: readonly OutlookMessageSummary[];
  change: CategoryChange;
  thread: boolean;
}): OutlookChangePlan {
  return {
    intent: "category",
    steps: targets.map((target): OutlookChangeStep => {
      const next = nextCategories({ change, current: target.categories });
      return next.changed
        ? { id: target.id, kind: "patch", patch: { categories: next.categories } }
        : { id: target.id, kind: "unchanged" };
    }),
    thread,
  };
}

/**
 * Plan `archive` (or `--restore`): move every target not already in the destination folder.
 *
 * @param destinationId the resolved Archive (or Inbox) folder id
 * @returns the plan
 */
export function planMove({
  targets,
  destinationId,
  thread,
}: {
  targets: readonly OutlookMessageSummary[];
  destinationId: string;
  thread: boolean;
}): OutlookChangePlan {
  return {
    intent: "archive",
    steps: targets.map((target): OutlookChangeStep =>
      target.folderId === destinationId
        ? { id: target.id, kind: "unchanged" }
        : { destinationId, id: target.id, kind: "move" },
    ),
    thread,
  };
}

/**
 * Apply a plan, one message at a time, stopping at the first failed write.
 *
 * @param plan what to write
 * @returns exactly which messages changed, which needed nothing, and which failed or were not reached
 */
export async function applyOutlookChange({
  api,
  plan,
}: {
  api: OutlookApi;
  plan: OutlookChangePlan;
}): Promise<OutlookChangeOutcome> {
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const [index, step] of plan.steps.entries()) {
    if (step.kind === "unchanged") {
      unchanged.push(step.id);
      continue;
    }
    const written =
      step.kind === "patch"
        ? await api.patchMessage({ id: step.id, patch: step.patch })
        : await api.moveMessage({ destinationId: step.destinationId, id: step.id });
    if (written.isErr()) {
      return {
        changed,
        failed: { id: step.id, message: written.error.message },
        intent: plan.intent,
        notAttempted: plan.steps.slice(index + 1).map((rest) => rest.id),
        unchanged,
      };
    }
    changed.push(step.id);
  }
  return { changed, failed: undefined, intent: plan.intent, notAttempted: [], unchanged };
}
