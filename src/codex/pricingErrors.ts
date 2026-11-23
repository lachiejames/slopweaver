/**
 * The one failure channel of Codex pricing — reading a rate card off disk, and validating what was read.
 *
 * Two variants, because a caller does branch on which happened: a card that could not be READ is a path the
 * operator typed wrong or a file that is not JSON, and a card that was read but is not a card is a content
 * problem whose whole interface is the LIST of what is wrong with it. Both carry `problems`, so a renderer
 * prints one shape either way, and `code` is what distinguishes "point at the path" from "fix these fields".
 *
 * The multiplicity that `.claude/rules/error-handling.md` § When NOT to introduce a union protects is kept
 * here rather than discarded: a hand-written card is fixed one full pass at a time, so every problem in it
 * is reported at once, and the union carries that list rather than collapsing it to one message.
 */

/**
 * A rate card that could not be read at all — an absent path, or bytes that are not JSON.
 *
 * @internal a member of the exported {@link CodexPricingError}, matched by `code` rather than imported.
 */
export interface RateCardUnreadableError {
  readonly code: "RATE_CARD_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly problems: readonly string[];
}

/** A rate card that was read, but is not one — every field that is wrong with it. */
export interface RateCardInvalidError {
  readonly code: "RATE_CARD_INVALID";
  readonly message: string;
  readonly problems: readonly string[];
}

/** Everything pricing can refuse. */
export type CodexPricingError = RateCardUnreadableError | RateCardInvalidError;

/**
 * Builds one unreadable-card failure, so a test constructs it exactly as the real code does.
 *
 * @param cause what the filesystem boundary said
 * @returns the typed failure, its single problem being the message
 */
function unreadable({ cause, path }: { cause: string; path: string }): RateCardUnreadableError {
  const message = `could not read the rate card at ${path}: ${cause}`;
  return { code: "RATE_CARD_UNREADABLE", message, path, problems: [message] };
}

/** Builds each variant, so a test constructs a failure exactly as the real code does. */
export const CodexPricingErrors = {
  invalid: ({ problems }: { problems: readonly string[] }): RateCardInvalidError => ({
    code: "RATE_CARD_INVALID",
    message: `the rate card is not usable: ${problems.join("; ")}`,
    problems,
  }),
  unreadable,
} as const;
