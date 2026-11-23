/**
 * Which checkout a relay row is born with — the `repo:` that lets `cmux spawn` seat it, or none for an answer.
 *
 * MEASURED: 58 `talk-*` relay rows sat in `handover list`'s RUN NOW while the chair called the board
 * quiet, because `talk relay` registered every one with no `--repo` and `cmux spawn` refuses such a row. A relay's
 * work is a Slopweaver seat reading their words and acting on them, so its checkout is this build's own repository's
 * declared main checkout.
 *
 * The one exception is a relay whose words land on an `ask:` card: the ask's own row carries that work (the landing
 * names it as the relay's `workSlug`), so the relay is born with no repo, as an answer, and is filed into the ask once
 * its run records it (`../handover/relaySettleForWork.ts`). Seating it too would put two seats on one piece of work.
 */
import { resolveRepoCheckout } from "../../../handover/repoCheckout.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { resolveSelfRepository } from "../../../organisation/read.js";
import type { RelayCardDisposition } from "../../../talk/relayChannelSteer.js";

/** The card kind whose own row carries the work their words over it are a ruling on. */
const ASK_PREFIX = "ask:";

/** This build's own checkout did not resolve, so the relay is born with no repo and held. */
export interface RelayRepositoryUnresolvedError {
  readonly code: "RELAY_REPOSITORY_UNRESOLVED";
  readonly message: string;
}

/** Build the refusal. */
const RelayRepositoryErrors = {
  unresolved: ({ stage, why }: { stage: string; why: string }): RelayRepositoryUnresolvedError => ({
    code: "RELAY_REPOSITORY_UNRESOLVED",
    message: `this build's own checkout did not resolve (${stage}): ${why}`,
  }),
} as const;

/**
 * Whether a relay is an answer the ask's own row carries: their words land on the `ask:` card they were spoken over.
 *
 * @param about the card the relay is about, `""` for none
 * @param disposition whether their words land on that card
 * @returns true only for an `ask:` card their words land on
 */
export function relayUsesAskRow({ about, disposition }: { about: string; disposition: RelayCardDisposition }): boolean {
  return about.startsWith(ASK_PREFIX) && disposition.kind === "land";
}

/**
 * The checkout a relay row is registered with.
 *
 * @param about the card the relay is about, `""` for none
 * @param disposition whether their words land on that card
 * @param home the state home whose profile declares the main checkouts
 * @returns the checkout, `undefined` for an answer relay (intentionally repo-less), or why this build's own checkout
 *   did not resolve
 */
export function resolveRelayRepository({
  about,
  disposition,
  home,
}: {
  about: string;
  disposition: RelayCardDisposition;
  home: string;
}): Result<string | undefined, RelayRepositoryUnresolvedError> {
  if (relayUsesAskRow({ about, disposition })) {
    return ok(undefined);
  }
  const self = resolveSelfRepository({ home });
  if (self.isErr()) {
    return err(RelayRepositoryErrors.unresolved({ stage: "self repository", why: self.error.message }));
  }
  // The judgement `handover register --repo` makes, so a checkout it would refuse — a declared linked worktree, a
  // subdirectory — is unresolved here and the relay is held, never a register refusal that loses the row.
  const checkout = resolveRepoCheckout({ home, requested: self.value });
  if (checkout.isErr()) {
    return err(RelayRepositoryErrors.unresolved({ stage: "declared checkout", why: checkout.error.message }));
  }
  return ok(checkout.value);
}
