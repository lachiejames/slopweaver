/**
 * The PURE half of every Gmail mutation — label vocabulary, reference resolution, and the plan a verb hands
 * the API seam.
 *
 * ## Everything phase B does is a label change
 *
 * Gmail has no "archive" call and no "mark as read" call. It has exactly one mutation —
 * `users.messages.modify`, which adds and removes label ids — and the three things the owner asked for are
 * that one call wearing three names:
 *
 * | the ask            | the label change    |
 * | ------------------ | ------------------- |
 * | mark read          | remove `UNREAD`     |
 * | mark unread        | add `UNREAD`        |
 * | archive            | remove `INBOX`      |
 * | restore to inbox   | add `INBOX`         |
 * | label / unlabel    | add / remove any id |
 *
 * So there is one planner here and one seam call, rather than three parallel paths that could drift. The
 * verbs differ in what they NAME, which is the half a person cares about.
 *
 * ## Names and ids are not the same thing, and that is Gmail's trap
 *
 * A system label's id IS its name — `INBOX`, `UNREAD`, `STARRED`. A label a person made has an opaque id
 * (`Label_7`) and a display name (`Waiting on`), and nested labels put a `/` in the name. The API takes ids
 * ONLY, so a caller typing the name they can see in Gmail gets a silent no-op unless something resolves it.
 * {@link resolveLabelRef} is that something: it matches names first, then falls back to an exact id.
 *
 * Because a system label's name and id are the same string, "name first" does not let a user label outrank
 * a system one — a user label whose name differs only in case from `IMPORTANT` matches BOTH, and the
 * resolver refuses and names both ids rather than picking. That refusal is the right answer to a genuinely
 * ambiguous reference, and it is also unreachable through Gmail's own interface, which will not create a
 * user label that collides case-insensitively with a system one. It is guarded because the resolver takes
 * whatever vocabulary the API returns, not because the mailbox is expected to contain one.
 *
 * Pure: no I/O, no clock.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type GmailError, GmailErrors } from "./errors.js";

/** The system label ids this door names in its own code, rather than as caller-supplied strings. */
export const SYSTEM_LABELS = {
  inbox: "INBOX",
  spam: "SPAM",
  trash: "TRASH",
  unread: "UNREAD",
} as const;

/**
 * Label ids `gmail label` refuses to add, whatever else it is asked to do.
 *
 * This is THIS DOOR'S rail, not a report of Google's. Adding `TRASH` deletes mail and adding `SPAM` trains
 * a classifier against the sender; both are one word away from an ordinary `--add`, neither is what phase B
 * was asked for, and neither is something to discover by having done it. Removing them is not blocked — a
 * message wrongly in spam should be rescuable through the same verb.
 *
 * @internal — read by {@link rejectUnaddableLabels} and asserted by its tests; no caller outside this module
 * names it.
 */
export const UNADDABLE_LABEL_IDS: readonly string[] = [SYSTEM_LABELS.trash, SYSTEM_LABELS.spam];

/** One label as Gmail reports it. `type` separates the built-in vocabulary from what a person created. */
export interface GmailLabel {
  readonly id: string;
  readonly name: string;
  readonly type: "system" | "user";
}

/**
 * Narrow Gmail's label `type` to this repo's two-value union, defaulting an unknown or absent value to
 * `user`. The API documents only `system` and `user`, but the generated type is `string | null | undefined`,
 * and a label that is not provably built-in is the safer thing to treat as one a person made.
 *
 * @param type the `type` field of one `users.labels.list` entry
 * @returns `system` for a built-in label, else `user`
 */
export function labelType({ type }: { type: string | null | undefined }): GmailLabel["type"] {
  return type === "system" ? "system" : "user";
}

/** A resolved mutation: exactly the two id lists `users.messages.modify` takes, plus whether it changes anything. */
export interface GmailLabelPlan {
  readonly addLabelIds: readonly string[];
  readonly removeLabelIds: readonly string[];
  /** True when the message already has every added label and none of the removed ones — nothing to send. */
  readonly noop: boolean;
}

/**
 * Resolve one caller-supplied label reference — a display name or a raw id — to the id the API takes.
 *
 * Name matching is case-insensitive because the Gmail UI's own label picker is, and a person reading
 * `Waiting On` off their sidebar should not have to reproduce its capitalisation. An id match is exact:
 * ids are opaque and case is meaningful in them.
 *
 * @param ref what the caller typed
 * @param labels every label the mailbox has, as `users.labels.list` returned them
 * @returns the label id, or the typed reason no single label matched
 */
export function resolveLabelRef({
  ref,
  labels,
}: {
  ref: string;
  labels: readonly GmailLabel[];
}): Result<string, GmailError> {
  const wanted = ref.trim();
  if (wanted.length === 0) {
    return err(GmailErrors.invalidAddress({ message: "an empty label was given — name a label or its id" }));
  }
  const byName = labels.filter((label) => label.name.toLowerCase() === wanted.toLowerCase());
  if (byName.length === 1) {
    return ok(byName[0]!.id);
  }
  if (byName.length > 1) {
    return err(
      GmailErrors.invalidAddress({
        message:
          `"${wanted}" matches ${String(byName.length)} labels by name (${byName.map((label) => label.id).join(", ")}) ` +
          "— give the id instead",
      }),
    );
  }
  const byId = labels.find((label) => label.id === wanted);
  if (byId !== undefined) {
    return ok(byId.id);
  }
  return err(
    GmailErrors.invalidAddress({
      message: `no label named or identified by "${wanted}" exists in this mailbox — \`slopweaver gmail labels\` lists them`,
    }),
  );
}

/**
 * Resolve every reference in one direction, reporting the FIRST failure rather than a partial plan.
 *
 * @param refs the caller's label references, in the order they were written
 * @param labels the mailbox's label vocabulary
 * @returns each resolved id, or the typed reason one could not be resolved
 */
export function resolveLabelRefs({
  refs,
  labels,
}: {
  refs: readonly string[];
  labels: readonly GmailLabel[];
}): Result<readonly string[], GmailError> {
  const resolved: string[] = [];
  for (const ref of refs) {
    const one = resolveLabelRef({ labels, ref });
    if (one.isErr()) {
      return err(one.error);
    }
    resolved.push(one.value);
  }
  return ok(resolved);
}

/**
 * Refuse a plan that would add a label this door does not add. See {@link UNADDABLE_LABEL_IDS}.
 *
 * @param addLabelIds the ids the plan would add
 * @returns nothing on success, or the typed refusal naming the label and the verb that does it properly
 */
export function rejectUnaddableLabels({ addLabelIds }: { addLabelIds: readonly string[] }): Result<null, GmailError> {
  const blocked = addLabelIds.filter((id) => UNADDABLE_LABEL_IDS.includes(id));
  if (blocked.length === 0) {
    return ok(null);
  }
  return err(
    GmailErrors.invalidAddress({
      message:
        `refusing to add ${blocked.join(", ")} — adding TRASH deletes mail and adding SPAM trains a filter ` +
        "against the sender. Neither is what a label change is for, and this door does not do either",
    }),
  );
}

/**
 * Build the plan for one message, dropping the halves that would change nothing.
 *
 * The dropping is what makes `noop` meaningful, and it is worth stating why it is here rather than left to
 * the API: `modify` accepts a request to add a label a message already has and reports success, so a caller
 * that did not compare would report "archived" for a message that was never in the inbox. The verb can only
 * be honest about what it changed if the plan knows what was already true.
 *
 * @param addLabelIds every label id the caller asked to add
 * @param removeLabelIds every label id the caller asked to remove
 * @param currentLabelIds the label ids the message carries right now
 * @returns the deduplicated plan, narrowed to the changes that are real
 */
export function planLabelChange({
  addLabelIds,
  removeLabelIds,
  currentLabelIds,
}: {
  addLabelIds: readonly string[];
  removeLabelIds: readonly string[];
  currentLabelIds: readonly string[];
}): GmailLabelPlan {
  const current = new Set(currentLabelIds);
  const add = [...new Set(addLabelIds)].filter((id) => !current.has(id));
  const remove = [...new Set(removeLabelIds)].filter((id) => current.has(id));
  return { addLabelIds: add, noop: add.length === 0 && remove.length === 0, removeLabelIds: remove };
}

/**
 * Build the plan for a whole thread, where "already true" is not a single message's answer.
 *
 * A thread is a set of messages with DIFFERENT label sets — one read, three unread; two archived, one still
 * in the inbox. So a thread plan narrows nothing: it sends what was asked, and reports `noop` only when no
 * message in the thread would move. Narrowing against the first message, or against the union, would skip
 * the messages that actually needed the change — which is the thread-shaped version of the same silent
 * no-op {@link planLabelChange} exists to prevent.
 *
 * @param addLabelIds every label id the caller asked to add
 * @param removeLabelIds every label id the caller asked to remove
 * @param messageLabelIds each thread message's current label ids
 * @returns the deduplicated plan, with `noop` true only when every message is already in the asked-for state
 */
export function planThreadLabelChange({
  addLabelIds,
  removeLabelIds,
  messageLabelIds,
}: {
  addLabelIds: readonly string[];
  removeLabelIds: readonly string[];
  messageLabelIds: readonly (readonly string[])[];
}): GmailLabelPlan {
  const add = [...new Set(addLabelIds)];
  const remove = [...new Set(removeLabelIds)];
  const moves = messageLabelIds.some((labels) => {
    const current = new Set(labels);
    return add.some((id) => !current.has(id)) || remove.some((id) => current.has(id));
  });
  return { addLabelIds: add, noop: !moves, removeLabelIds: remove };
}
