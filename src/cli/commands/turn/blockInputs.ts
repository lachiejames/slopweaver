/**
 * The pure read of `turn block`'s own flags — `--need`, `--what` and `--sign-in-url` — into the inputs one block is
 * composed from. Its own module because `turn reach` composes the same inputs without reading a flag, and both enter
 * the block through `./block.ts`'s one effect path.
 */
import { BLOCKED_NEEDS, type BlockedNeed } from "../../../live/ask/lifecycle.js";
import { signInOriginOf } from "../../../live/ask/signInOrigin.js";
import { str } from "./core.js";

/** What this verb composes a block from: the two required values, and the page a browser sign-in happens on. */
export interface BlockInputs {
  readonly need: BlockedNeed;
  readonly what: string;
  /**
   * The bare HTTPS origin the owner signs in to, read off `--sign-in-url` — present only on a `sign-in` block whose
   * sign-in is a page in the owner's work Chrome, which is what the `turn-signed-out` monitor cards.
   */
  readonly signInOrigin?: string | undefined;
}

/**
 * Read `--need` as one of the four. Pure and total.
 *
 * An unrecognised value is `undefined` rather than falling back to `other`, because the need is what both
 * the card and the thread tag are worded from: a typo silently becoming the vaguest of the three would post
 * the least informative sentence of the set and say nothing about having done so.
 *
 * @param value the raw `--need` value, or `undefined` when the flag was omitted
 * @returns the need, or `undefined` when the value names none of them
 */
export function blockedNeedFrom({ value }: { value: string | undefined }): BlockedNeed | undefined {
  return BLOCKED_NEEDS.find((need) => need === value);
}

/**
 * Read `--sign-in-url` against the need it rides with: absent is fine, present is an HTTPS URL on a `sign-in`.
 *
 * Beside any other need it is REFUSED rather than ignored — a page recorded on a risky-approval would be dead
 * metadata a reader could take for a sign-in the monitor never carded.
 *
 * @param need the block's need, when it read
 * @param url the raw `--sign-in-url`, when given
 * @returns the origin to store, or the one problem with the flag
 */
function signInOriginInput({
  need,
  url,
}: {
  need: BlockedNeed | undefined;
  url: string | undefined;
}): { readonly origin: string | undefined } | { readonly problem: string } {
  if (url === undefined) {
    return { origin: undefined };
  }
  if (need !== "sign-in") {
    return { problem: "--sign-in-url is only for --need sign-in" };
  }
  const origin = signInOriginOf({ url: url.trim() });
  if (origin === undefined) {
    return { problem: `--sign-in-url must be an https:// page, got ${JSON.stringify(url)}` };
  }
  return { origin };
}

/**
 * Read `--need`, `--what` and `--sign-in-url`, or name every problem that stopped the verb. Pure and total.
 *
 * @param values the parsed flag values
 * @returns the inputs, or every flag that was missing or unreadable
 */
export function turnBlockInputs({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}):
  | { readonly kind: "ready"; readonly inputs: BlockInputs }
  | { readonly kind: "invalid"; readonly problems: readonly string[] } {
  const need = blockedNeedFrom({ value: str({ key: "need", values }) });
  const what = str({ key: "what", values })?.trim();
  const signIn = signInOriginInput({ need, url: str({ key: "sign-in-url", values }) });
  const problems = [
    need === undefined ? `--need (${BLOCKED_NEEDS.join(", ")}) is required` : undefined,
    what === undefined || what.length === 0 ? "--what is required" : undefined,
    "problem" in signIn ? signIn.problem : undefined,
  ].filter((problem): problem is string => problem !== undefined);
  if (need === undefined || what === undefined || what.length === 0 || "problem" in signIn) {
    return { kind: "invalid", problems };
  }
  return {
    inputs: { need, what, ...(signIn.origin === undefined ? {} : { signInOrigin: signIn.origin }) },
    kind: "ready",
  };
}
