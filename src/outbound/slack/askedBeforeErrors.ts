/**
 * The typed failures of a draft's `--asked-before` declaration (`./priorAsk.ts`): a declaration that cannot mean
 * anything as given, and an earlier ask that could not be read whole. Per `.claude/rules/error-handling.md` the union
 * stands alone; the draft register's own failures are `./draftErrors.ts`.
 */

/**
 * The earlier ask a `--asked-before <permalink>` names could not be read whole, so nothing proves whether the team
 * answered it — and an earlier ask read as unanswered because the read failed is the re-ask the declaration stops.
 */
export interface PriorAskUnreadableError {
  readonly code: "PRIOR_ASK_UNREADABLE";
  readonly message: string;
  readonly permalink: string;
  readonly cause: unknown;
}

/**
 * A `--asked-before` declaration that cannot park as given: its companions without a prior, its companions beside
 * `none`, a proof with no picture in it, or a token whose `auth.test` names nobody the earlier ask could be by.
 */
export interface AskedBeforeRefusedError {
  readonly code: "ASKED_BEFORE_REFUSED";
  readonly message: string;
  readonly reason: "companions-without-prior" | "companions-on-none" | "proof-without-picture" | "prior-without-self";
}

/** Everything a re-ask declaration can fail with. */
export type AskedBeforeError = AskedBeforeRefusedError | PriorAskUnreadableError;

/** A thrown value's own words, or its string form when it is not an Error. */
function causeText({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The one place an {@link AskedBeforeError} is constructed, so a test builds what the real code builds. */
export const AskedBeforeErrors = {
  companionsOnNone: (): AskedBeforeRefusedError => ({
    code: "ASKED_BEFORE_REFUSED",
    message:
      "--asked-before none says this question was never asked, so there is no earlier answer for --changed, " +
      "--changed-media or --not-answered to describe — drop them, or name the earlier message",
    reason: "companions-on-none",
  }),
  companionsWithoutPrior: (): AskedBeforeRefusedError => ({
    code: "ASKED_BEFORE_REFUSED",
    message: "--changed, --changed-media and --not-answered describe an earlier ask: pass --asked-before <permalink>",
    reason: "companions-without-prior",
  }),
  priorUnreadable: ({ cause, permalink }: { cause: unknown; permalink: string }): PriorAskUnreadableError => ({
    cause,
    code: "PRIOR_ASK_UNREADABLE",
    message:
      `the earlier ask at ${permalink} could not be read whole (${causeText({ cause })}), so nothing shows whether ` +
      "the team answered it — nothing was parked or sent; read it again once Slack answers",
    permalink,
  }),
  proofWithoutPicture: (): AskedBeforeRefusedError => ({
    code: "ASKED_BEFORE_REFUSED",
    message:
      "--changed-media carries no picture, only documents: the proof of a change is something the owner can look at on " +
      "the card — a chart or a screenshot of one.",
    reason: "proof-without-picture",
  }),
  withoutSelf: ({ permalink }: { permalink: string }): AskedBeforeRefusedError => ({
    code: "ASKED_BEFORE_REFUSED",
    message:
      `--asked-before ${permalink}: auth.test named no user for this token, so nothing can say whether the ` +
      "earlier message is ours.",
    reason: "prior-without-self",
  }),
} as const;
