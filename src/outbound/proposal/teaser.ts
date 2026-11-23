/**
 * The Slack teaser: the concise, voice-written post that carries a proposal into a channel.
 *
 * ## The pattern this reproduces
 *
 * The proposal link leading a short version of it, and the discussion in the thread. The doc is the deeper
 * layer; the Slack post is what people actually read. The owner's own worked example of this ran long, and
 * around a hundred words would have been better — which is why the teaser is
 * capped in the schema rather than left to judgement.
 *
 * ## ONE message, never a sequence
 *
 * A proposal or discussion piece raised in Slack is a single top-level message under the owner's own name —
 * the owner's ruling — because several top-level messages leave a reader unsure which one to reply
 * to, and the discussion fragments across them. An earlier version of this file posted the link and the
 * teaser as two separate drip messages; that arrangement is now overruled, and `renderTeaser` emits exactly
 * one. It is a one-message DRIP rather than a raised-cap conversational one: `slack post --as me`'s
 * `messageVisibleMax` (the per-message cap on a multi-message drip, "a concise sentence or two") stays
 * untouched, and a sole-message drip like this one is bounded by `soleMessageVisibleMax` instead — see
 * `../artifact/asMeSchema.ts`'s `dripArtifactSchema`.
 *
 * ## It renders a form. It never posts.
 *
 * The output is exactly what `slopweaver slack post --as me --shape top-level --form -` accepts, and it is
 * printed rather than sent. Posting as the owner is the owner's act, not a verb's: this file's whole job is to
 * remove the excuse that composing the form was fiddly.
 *
 * Pure: form plus the published proposal's URL in, an as-me drip artifact out.
 */
import type { ProposalForm } from "./types.js";

/** One inline run of an as-me drip message. */
type TeaserRun =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "link"; readonly label: string; readonly url: string };

/** The as-me drip artifact `slack post --as me` accepts. */
export interface TeaserArtifact {
  readonly kind: "drip";
  readonly messages: readonly { readonly runs: readonly TeaserRun[] }[];
}

/**
 * Slack's own cap on a link label, which the as-me form enforces.
 *
 * A proposal title longer than this is not an error — it is a perfectly good title — so the label falls back
 * to a fixed phrase rather than the send being refused for something the author cannot see coming.
 */
export const LINK_LABEL_MAX = 120;

/** The label the proposal link sits on. */
function linkLabel({ form }: { form: ProposalForm }): string {
  return form.title.length <= LINK_LABEL_MAX ? form.title : "the proposal";
}

/**
 * Render the Slack teaser form for a published proposal.
 *
 * ONE message: the link leads, then a colon into the authored teaser — not an em dash, which the owner's own
 * exact voice rules ban outright and which `slack post --as me` enforces at the send seam regardless of what
 * this file emits. Two runs in a single message reads the same as two messages once posted: the link still
 * unfurls, and it still sits first, without splitting the announce into a sequence a reader might reply to
 * piecemeal. The link's own visible width is just its label, so it never eats into the 100-word budget
 * `form.slackTeaser` was written against.
 *
 * @param form the validated proposal form, whose `slackTeaser` field is the authored short version
 * @param proposalUrl where the published proposal lives, on whichever destination it went to
 * @returns the as-me drip artifact, ready for `slack post --as me --shape top-level --form -`
 */
export function renderTeaser({ form, proposalUrl }: { form: ProposalForm; proposalUrl: string }): TeaserArtifact {
  return {
    kind: "drip",
    messages: [
      {
        runs: [
          { label: linkLabel({ form }), type: "link", url: proposalUrl },
          { text: `: ${form.slackTeaser}`, type: "text" },
        ],
      },
    ],
  };
}
