/**
 * The PRE-SEND render proof — the one case a public as-me post has no other control over.
 *
 * `./renderCheck.ts` covers two of the three positions. A `--form` send is checked before the wire, because
 * its blocks exist and what Slack stores for a `rich_text` message is what we sent. Every send is checked
 * after the wire against what Slack stored. That leaves exactly one hole, and it is the worst-shaped one:
 *
 * > A raw `--body` post to a PUBLIC channel is a bare string whose styling and mentions are decided by
 * > Slack's own parse, and that parse does not happen until it is already public.
 *
 * This closes it by making the parse happen somewhere private first. The identical bytes go to the
 * operator's own render-proof conversation, come back through the same `storedRenderIssues` check, and are
 * deleted. A hit refuses the real send; a clean proof lets it through.
 *
 * **It fails CLOSED, with a key.** The owner's ruling is to block by default, print what was blocked and why, and name the one way past it — one hatch per
 * risk, journalled, expiring. So an unconfigured proof channel, a proof that will not post, and a proof that
 * comes back dirty all REFUSE, and every one of them names the {@link RENDER_PROOF_HATCH} grant. Failing
 * closed with no key would be the hard block that ruling exists to forbid.
 *
 * The fail-open reasoning in `../../cli/commands/slack/dripRun.ts`'s receipt deliberately does NOT transfer
 * here, and the difference is the whole reason these are two mechanisms. There, the message is already
 * published when the check runs, so a lost read-back can only mislead about something that is out. Here
 * nothing is published yet, so a lost proof means the send has never been checked at all.
 */
import { hatchFor } from "../../hatch/lookup.js";
import { hatchIncantation } from "../../hatch/types.js";
import type { ConversationSurface, DripShape } from "./types.js";

/** The journalled hatch for a caller who has decided to post a public raw body without proving its render. */
const RENDER_PROOF_HATCH = "unproven-render";

/** The command every render-proof refusal names, derived from the register row. */
const RENDER_PROOF_ESCAPE = hatchIncantation({ hatch: hatchFor({ id: RENDER_PROOF_HATCH }) });

/**
 * Where the proof would be posted, read back and deleted, and whether the caller has waived it.
 *
 * @internal Exported only so the shell in `../../cli/commands/slack/wallCheck.ts` names one shape.
 */
export interface RenderProofPolicy {
  readonly shape: DripShape;
  readonly surface: ConversationSurface | undefined;
  /** Whether this send is the raw `--body` escape hatch rather than a typed form. */
  readonly rawBody: boolean;
  /** `slackMe.renderProofChannel` from `profile.json`, absent on an install that has not set one. */
  readonly proofChannel: string | undefined;
  /** Whether this session holds a live `unproven-render` grant. */
  readonly allowUnproven: boolean;
}

/**
 * Whether this send must prove its render somewhere private before it goes out.
 *
 * Narrow on purpose. A typed form is already checked before the wire, a thread is not the public top-level
 * shape the ruling is about, and a private channel or DM is not the *very public place* whose cost motivated
 * any of this. An unestablished surface counts as public, matching `./publicCardGate.ts` — the case a wrong
 * guess is expensive in is the public one.
 *
 * @param rawBody whether this is the escape hatch rather than a typed form, the only lane needing a proof
 * @param surface what Slack's own flags say the channel is, or `undefined` when the read could not answer
 * @returns true when the proof round trip has to run before anything is posted
 */
export function needsRenderProof({ shape, surface, rawBody, allowUnproven }: RenderProofPolicy): boolean {
  if (allowUnproven || !rawBody || shape !== "top-level") {
    return false;
  }
  return surface !== "direct-message" && surface !== "private-channel";
}

/**
 * The refusal for a send whose proof could not run at all, because nowhere is configured to run it.
 *
 * Names BOTH remedies, because they are different decisions rather than one with a fallback: configuring
 * the channel makes every future send provable, while the override waives this one send only.
 *
 * @returns the refusal naming the config field and the single-run override
 */
export function unconfiguredProofRefusal(): readonly string[] {
  return [
    "a raw `--body` post to a public channel cannot be checked before it is public — Slack decides its " +
      "styling and mentions at parse time, and that parse is the thing being verified. No " +
      "`slackMe.renderProofChannel` is set in profile.json, so there is nowhere private to make that parse " +
      "happen first. Set it to a conversation you own (the bot's own DM is the intended one), or for one " +
      `deliberate unproven send run ${RENDER_PROOF_ESCAPE}.`,
  ];
}

/**
 * The refusal for a proof round trip that could not complete — a post, read-back or delete that failed.
 *
 * @param reason what actually went wrong, carried forward rather than flattened into "the proof failed"
 * @returns the refusal naming the cause and the single-run override
 */
export function unprovableRefusal({ reason }: { reason: string }): readonly string[] {
  return [
    `the render proof for this public raw body could not be completed, so this send has never been ` +
      `checked: ${reason}. Nothing was posted to the target channel. Retry, or for one deliberate ` +
      `unproven send run ${RENDER_PROOF_ESCAPE}.`,
  ];
}

/**
 * The refusal for a proof that came back DIRTY — Slack's own parse of these exact bytes renders wrong.
 *
 * This is the one arm that is not about infrastructure at all. The round trip worked perfectly and the
 * answer was no, which is the entire point of running it.
 *
 * @param issues what `storedRenderIssues` found in Slack's stored copy of the proof
 * @returns one refusal per issue, plus the line naming the override
 */
export function dirtyProofRefusal({ issues }: { issues: readonly string[] }): readonly string[] {
  return [
    ...issues.map(
      (issue) => `Slack's own parse of this body renders wrong, proved before anything went public. ${issue}`,
    ),
    `Fix the body, or for one deliberate unproven send run ${RENDER_PROOF_ESCAPE}.`,
  ];
}
