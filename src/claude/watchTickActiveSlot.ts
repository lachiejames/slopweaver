/**
 * What the ACTIVE slot holds, and which answer named the plan on it: the vocabulary one watch tick's ladder speaks,
 * and the two pure judgements over the slot's own credential. Pure and separate from `./watchTick.ts`, which walks
 * the ladder and decides the tick; its header carries the measurements behind every value here.
 */
import { type ClaudeCredentialSlice, credentialExpiryIso, credentialHasAccessToken } from "./credentialDocument.js";

/**
 * Which of the answers named the active plan, or that none did. Ordered strongest first, and rendered
 * verbatim into the tick line so a reader is never left guessing how confident the loop is.
 *
 * `none` and `unknown` are the two different ways of not naming one, and keeping them apart is the whole
 * point of the distinction: `unknown` means the slot holds a live credential this tick could not attribute
 * to a plan, and `none` means the slot holds no live credential at all, so there is no active plan to
 * attribute. See {@link ActiveSlotHolding}.
 */
export type ActiveFrom = "pinned" | "identified" | "observed" | "deduced" | "recorded" | "none" | "unknown";

/**
 * What the ACTIVE slot's own credential is, as the shell found it — the fact that separates "which plan is
 * active" from "is any plan active at all".
 *
 * MEASURED on this machine, which is why this is an input rather than an assumption. The default
 * slot's credential had expired days earlier and every one of the four configured stores held a
 * live one. The unpinned standing loop therefore reached `unknown` on every tick — no organisation came back
 * for a dead token, and no store byte-matched it — and `unknown` holds EVERY store back from keep-alive. So
 * the one loop whose entire job is to keep four stores alive had refreshed none of them for seven days,
 * protecting a credential nothing was authenticating with. Reproduce with
 * `env -u CLAUDE_SECURESTORAGE_CONFIG_DIR slopweaver claude watch --once --dry-run`.
 *
 * `live` is the conservative reading and the one a caller that has not established anything must send: it
 * preserves every guard exactly as it stood. `expired` and `absent` are positive findings — the slot was
 * read and it holds nothing a session could present — and only they release the holds.
 *
 * @internal — the type of {@link ActiveSlot.holding}; a caller threads the whole {@link ActiveSlot} through
 *   rather than naming this.
 */
export type ActiveSlotHolding =
  /** The slot holds a credential with a non-empty access token that has not expired, or whose expiry could not be read. */
  | "live"
  /** The slot holds an access token whose expiry is in the past, so no session can be presenting it. */
  | "expired"
  /** The slot holds no credential, or one whose access token is empty. */
  | "absent";

/**
 * What the shell found in the ACTIVE slot: the classification, and the instant behind it when there is one.
 *
 * One value rather than two parameters, and a UNION rather than an interface with an optional field. Review
 * pass r2 (`none-is-established-never-assumed`) falsified the weaker shape: `{ expiryIso?: string; holding:
 * ActiveSlotHolding }` type-checks all nine combinations, so `{ holding: "live", expiryIso: X }` and an
 * `expired` carrying no instant were both expressible while the doc claimed they were not. Written this way
 * the instant is REQUIRED exactly where it is meaningful and absent everywhere else, and the compiler is
 * what says so.
 *
 * **The residue, stated rather than claimed away**: `expired` paired with an instant that has NOT passed is
 * still expressible, and {@link reportableExpiryIso} will print it. Nothing downstream can catch that,
 * because catching it needs a second clock and {@link classifyActiveSlot} — the one producer — is the thing
 * that would be under test. A caller builds one of these from that function, never by hand.
 *
 * @internal — the shape {@link classifyActiveSlot} returns; a caller threads it through rather than
 *   constructing one.
 */
export type ActiveSlot =
  /** The slot holds a credential a session could present. No instant: there is nothing decided to report. */
  | { readonly holding: "live" }
  /** The slot holds no credential, or one whose access token is empty. There is no expiry to have read. */
  | { readonly holding: "absent" }
  /** The slot's access token expired at this instant, ISO-8601 — the reading that decided the holding. */
  | { readonly expiryIso: string; readonly holding: "expired" };

/**
 * Classify what the ACTIVE slot holds, from the credential slice the shell read out of it.
 *
 * Pure, and separate from the keychain read on purpose: this is the judgement that releases two guards, so
 * it is the half that has to be falsifiable in a unit test. It composes the two bounded readers in
 * `credentialDocument.ts` and looks inside nothing itself.
 *
 * An unreadable expiry answers `live`. The value of this answer is that it is a POSITIVE finding — the slot
 * was read and holds nothing a session could present — and a credential whose `expiresAt` cannot be parsed
 * has established no such thing. Guessing in the other direction would release the guards on an unknown.
 *
 * @param nowIso this tick's instant, ISO-8601 — injected, never read from a hidden clock
 * @param slice the credential slice read out of the active slot's document, absent when it holds none
 * @returns what the slot holds, and the expiry instant on the one path where it has already passed
 */
export function classifyActiveSlot({
  nowIso,
  slice,
}: {
  nowIso: string;
  slice: ClaudeCredentialSlice | undefined;
}): ActiveSlot {
  if (!credentialHasAccessToken({ slice })) {
    return { holding: "absent" };
  }
  const expiryIso = credentialExpiryIso({ slice });
  if (expiryIso === undefined || expiryIso > nowIso) {
    return { holding: "live" };
  }
  return { expiryIso, holding: "expired" };
}

/**
 * The expiry instant the tick line may print, which is only ever one that has ALREADY passed.
 *
 * A falsifiable witness rather than a formatting detail: the instant is evidence that the slot is dead, so a
 * sentence carrying one the tick did not conclude had passed would be asserting the opposite of what it read.
 *
 * @param activeFrom which source named the active plan, or that none could
 * @param activeSlot what the slot holds
 * @returns the instant, or undefined on every path where the slot is not a dead one
 */
export function reportableExpiryIso({
  activeFrom,
  activeSlot,
}: {
  activeFrom: ActiveFrom;
  activeSlot: ActiveSlot;
}): string | undefined {
  if (activeFrom !== "none" || activeSlot.holding !== "expired") {
    return undefined;
  }
  return activeSlot.expiryIso;
}
