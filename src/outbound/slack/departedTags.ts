/**
 * A message as the owner never tags somebody who has left. Every person it tags is read off Slack's LIVE roster
 * (`users.info`) before the message is parked or sent, and a deactivated account refuses the whole message.
 *
 * The case that fixed the rule: a drafted reply tagged a colleague who had left weeks earlier, which would have been
 * terrible to send in public. The member store had said `active: false` for that id since its last `users.list`
 * fetch, yet the mention resolved, because
 * resolution asks whether an id is SOMEBODY and never whether that somebody is still here. The roster is read live
 * rather than off the store because the store is only as fresh as its last refresh, and a departure is exactly the
 * fact that changes between refreshes.
 *
 * An account Slack would not describe refuses too: "checked against the live roster" is the rule, and a check that
 * could not run has checked nothing.
 *
 * A member of ANOTHER workspace in a shared channel is the one account that passes without a `deleted` answer: the
 * rule's subject is somebody who left THIS workspace, which they never belonged to, and Slack does not expose their
 * own workspace's deactivations to this token. Every tag of a Slack Connect partner was once refused as
 * unreadable. `../../corpus/slack/writeApiAccount.ts` says what
 * proves "another workspace", and anything short of that proof stays unreadable.
 */

/** What `users.info` said about one tagged account, or why it could not say. */
export type TaggedAccount =
  | { readonly kind: "read"; readonly deleted: boolean; readonly name: string | undefined }
  | { readonly kind: "external"; readonly name: string | undefined }
  | { readonly kind: "unreadable"; readonly cause: string };

/**
 * The refusal lines for the tagged accounts a message may not carry, in the order the ids were given. Pure.
 *
 * @param accounts each tagged Slack id and what the live roster said about it
 * @returns one line per departed or unreadable account, and nothing when every one is live
 */
export function departedTagRefusals({ accounts }: { accounts: ReadonlyMap<string, TaggedAccount> }): readonly string[] {
  return [...accounts].flatMap(([id, account]) => {
    if (account.kind === "unreadable") {
      return [
        `could not read <@${id}> off Slack's live roster (${account.cause}), so whether they still work here is ` +
          "unknown and nothing goes out tagging them. Re-run once Slack answers, or drop the tag.",
      ];
    }
    if (account.kind === "external" || !account.deleted) {
      return [];
    }
    const who = account.name === undefined ? `<@${id}>` : `${account.name} (<@${id}>)`;
    return [
      `${who} is deactivated in Slack: they have left, so a message tagging them reads as if nobody noticed. ` +
        "Drop the tag, and tag whoever holds their work now.",
    ];
  });
}
