/**
 * The free usage-limit resets one Codex store holds, as `account/rateLimits/read` reports them — the wire shape
 * and its reading into this repository's vocabulary. Pure; `./accountLiveParse.ts` calls it for the one field of
 * that answer it covers, and `./resetConsume.ts` spends what it lists.
 */
import { z } from "zod";

import { epochSecondsToIso } from "#lib/date.js";

/**
 * One free usage-limit reset the provider itemised — `RateLimitResetCredit` in the app-server protocol
 * (`codex app-server generate-ts`, codex-cli 0.157.1). `status` and `resetType` are read as strings, so a value a
 * newer backend adds reaches a reader as itself rather than failing the whole account read as unreadable.
 */
const resetCreditWire = z.object({
  description: z.string().nullable().optional(),
  expiresAt: z.number().nullable().optional(),
  grantedAt: z.number().nullable().optional(),
  id: z.string().min(1),
  resetType: z.string().nullable().optional(),
  status: z.string(),
  title: z.string().nullable().optional(),
});

/** The `rateLimitResetCredits` field of an `account/rateLimits/read` answer; an older CLI omits it. */
export const resetCreditsWire = z
  .object({
    availableCount: z.number().int().nonnegative(),
    credits: z.array(resetCreditWire).nullable().optional(),
  })
  .nullable()
  .optional();

/** One free usage-limit reset a Codex account holds, as the provider itemised it. */
export interface CodexResetCredit {
  /** The provider's opaque id — what `account/rateLimitResetCredit/consume` takes as `creditId`. */
  readonly id: string;
  /** `available`, `redeeming`, `redeemed` or `unknown` today; only `available` is redeemable. */
  readonly status: string;
  /** When the reset lapses unused, or absent for one that does not expire. */
  readonly expiresAtIso?: string;
  /** The provider's own display title, when it sent one. */
  readonly title?: string;
}

/**
 * How many free usage-limit resets the store has not redeemed. Absent is zero here and nowhere else: the count
 * is only ever displayed, and an older CLI omits the field.
 *
 * @param credits the answer's `rateLimitResetCredits` field
 * @returns the unredeemed count
 */
export function resetCreditsOf({ credits }: { credits: z.infer<typeof resetCreditsWire> }): number {
  if (credits == null) {
    return 0;
  }
  return credits.availableCount;
}

/**
 * The resets the provider itemised, or absent when it sent only the count — `credits: null` means exactly that
 * in the protocol, so it is never read as an empty list.
 *
 * @param credits the answer's `rateLimitResetCredits` field
 * @returns a fragment to spread into a signed-in read, carrying `resetCreditsListed` only when the list came
 */
export function listedResetCreditsOf({ credits }: { credits: z.infer<typeof resetCreditsWire> }): {
  readonly resetCreditsListed?: readonly CodexResetCredit[];
} {
  const listed = credits?.credits;
  if (listed == null) {
    return {};
  }
  return {
    resetCreditsListed: listed.map((credit): CodexResetCredit => {
      const expiresAtIso = credit.expiresAt == null ? undefined : epochSecondsToIso({ seconds: credit.expiresAt });
      return {
        id: credit.id,
        status: credit.status,
        ...(expiresAtIso === undefined ? {} : { expiresAtIso }),
        ...(credit.title == null ? {} : { title: credit.title }),
      };
    }),
  };
}

/**
 * The earliest expiry among the resets still available, or undefined when the provider listed none with one.
 *
 * @param credits the resets the store listed, or undefined when it sent only a count
 * @returns the soonest expiry instant, ISO-8601
 */
export function soonestResetExpiry({
  credits,
}: {
  credits: readonly CodexResetCredit[] | undefined;
}): string | undefined {
  if (credits === undefined) {
    return undefined;
  }
  const expiries = credits.flatMap((credit) =>
    credit.status === "available" && credit.expiresAtIso !== undefined ? [credit.expiresAtIso] : [],
  );
  return expiries.toSorted().at(0);
}
