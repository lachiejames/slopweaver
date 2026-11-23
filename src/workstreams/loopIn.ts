/**
 * The conversation a mined candidate says is owed to one person, as a draft parked on the owner's Queue — never sent.
 *
 * Each workstream names the people who must be across it and owning it, with the owed
 * conversation drafted into the queue. So a candidate's `loopIn` carries each person by Slack member id with an
 * opener, and parking it goes through `slack draft record`'s own path: every as-me gate runs, and the owner reads, edits and
 * sends it from the Queue.
 *
 * The draft is found again by its `why`, which names the candidate and the person exactly, so a second press parks
 * nothing new while the first is held or sent, and the console can say which. No Slack read is needed to tell: the
 * stored channel is the DM Slack opened, but the why is ours.
 *
 * Pure. `./loopInStore.ts` is the effectful half.
 */
import { safeJsonStringify } from "#lib/safeJson.js";

import type { ReceiptsDeclaration } from "../outbound/slack/draftReceipts.js";
import type { SlackDraftItem } from "../outbound/slack/draftRegister.js";
import { formReceiptLinks } from "../outbound/slack/formReceipts.js";

/** Where a loop-in draft stands on the owner's Queue: held for the owner's yes, sent, or none parked (or the last one dropped). */
export type LoopInDraftState = "held" | "released" | "none";

/**
 * The draft's `--why`: which candidate, to whom, and that it is the conversation the candidate says is owed. Exact,
 * because it is how the draft is found again.
 *
 * @param candidateId which mined candidate, as `c-012`
 * @param candidateName the candidate's name, which the Queue card reads
 * @param person the person's Slack member id
 * @param name the person's name as the candidate gives it
 * @returns the one line the Queue card reads
 */
export function loopInWhyOf({
  candidateId,
  candidateName,
  person,
  name,
}: {
  candidateId: string;
  candidateName: string;
  person: string;
  name: string;
}): string {
  return `loop ${name} (${person}) in on "${candidateName}", the conversation mined candidate ${candidateId} says is owed`;
}

/**
 * The draft's form: the opener, one message, ending on an evidence link when one is given. A parked draft is one
 * drip message and the drip parse refuses a line break inside one, while a mined opener may carry one, so each break
 * (with the whitespace around it) becomes one space rather than the draft being refused.
 *
 * @param opener the opener the candidate carries for this person
 * @param link the evidence address to end on, or `undefined` for none
 * @returns the `--form` JSON
 */
export function loopInFormOf({ opener: raw, link }: { opener: string; link: string | undefined }): string {
  const opener = raw.replace(LINE_BREAK_RUN, " ");
  const runs =
    link === undefined
      ? [{ text: opener, type: "text" }]
      : [
          { text: `${opener} `, type: "text" },
          { label: "where this came from", type: "link", url: link },
        ];
  const form = { kind: "drip", messages: [{ runs }] };
  return safeJsonStringify({ label: "a loop-in form", value: form });
}

/** A line break, or a run of them, with the whitespace either side. */
const LINE_BREAK_RUN = /\s*[\r\n]+\s*/gu;

/**
 * The opener's draft and what it declares about its receipts (a claim made to a
 * person brings a link to where they can see it). An opener is mined text that may well make a claim, and it is never
 * self-evident: its basis is the candidate's evidence, not the message. So it ends on the first evidence item the
 * recorder derives as a link; with none, on the opener alone when the drip parse makes a receipt of an address in its
 * own text; and only with neither does it say, as what was tried, that no evidence item gave a link that counts as a receipt: an address may open in a browser and still be one the
 * drip form refuses (a Vanta policy document) or one it carries that is no receipt (`mailto:`), so the note never
 * claims more than the recorder's own derivation found.
 * Each is judged by {@link formReceiptLinks}, the parse and derivation `slack draft record` itself runs; a link the
 * record path adds after it (a bare Linear key it resolves) parks a `tried` opener as `attached`, the tried note kept.
 *
 * @param candidateId which mined candidate, as `c-012`
 * @param evidence the candidate's evidence items, in its own order
 * @param opener the opener the candidate carries for this person
 * @returns the `--form` JSON and the declaration the draft records with
 */
export function loopInOpenerOf({
  candidateId,
  evidence,
  opener,
}: {
  candidateId: string;
  evidence: readonly { readonly href: string | null }[];
  opener: string;
}): { readonly form: string; readonly receipts: ReceiptsDeclaration } {
  // The opener alone first, so a form that fails is blamed on what failed: the evidence is only tried once its
  // opener is known to parse, and an opener the drip form refuses (an empty one, say) is named as that.
  const plain = loopInFormOf({ link: undefined, opener });
  const own = formReceiptLinks({ form: plain });
  if (own === undefined) {
    return {
      form: plain,
      receipts: { kind: "tried", tried: `linking ${candidateId}'s evidence, but its opener's form does not parse` },
    };
  }
  for (const { href } of evidence) {
    if (href !== null) {
      const form = loopInFormOf({ link: href, opener });
      if (formReceiptLinks({ form })?.includes(href) === true) {
        return { form, receipts: { kind: "undeclared" } };
      }
    }
  }
  if (own.length > 0) {
    return { form: plain, receipts: { kind: "undeclared" } };
  }
  const items =
    evidence.length === 1
      ? "its 1 evidence item gave no"
      : `none of its ${String(evidence.length)} evidence items gave a`;
  return {
    form: plain,
    receipts: {
      kind: "tried",
      tried: `linking ${candidateId}'s evidence, but ${items} link that counts as a receipt`,
    },
  };
}

/**
 * The draft parked for one person on one candidate and where it stands: a held one first, else the latest sent one,
 * else none. A dropped draft is no draft — the owner threw it away, so another may be parked.
 *
 * @param items the draft register, folded
 * @param why the exact `why` {@link loopInWhyOf} gives
 * @returns the draft's id and state, the id `null` when none stands
 */
export function loopInDraftOf({ items, why }: { items: readonly SlackDraftItem[]; why: string }): {
  readonly draftId: string | null;
  readonly state: LoopInDraftState;
} {
  const mine = items.filter((item) => item.draft.why === why);
  const held = mine.find((item) => item.state === "held");
  if (held !== undefined) {
    return { draftId: held.id, state: "held" };
  }
  const released = mine.findLast((item) => item.state === "released");
  if (released !== undefined) {
    return { draftId: released.id, state: "released" };
  }
  return { draftId: null, state: "none" };
}
