/**
 * The block of the owner's voice rules a call's delegated model is minted with, so the first draft it writes as the
 * owner is already briefed. In a measured call the owner's first offer was written with no rule read, nothing on the
 * mint carried them, and the owner said so. A tool the model might call (`src/talk/modelReads.ts`) is a skippable round
 * trip after the first turn has begun, and the stored pack can be an hour old and may be left out altogether, so this is
 * read fresh at every mint and rides whatever the pack did.
 *
 * It renders the composer's own brief (`src/outbound/voice/composerBrief.ts`) whole, never a second copy of it, and holds
 * no word of the owner's voice itself. What it costs: the delegated thread's instructions grow by the brief on every turn of
 * every call, and it crosses to the delegated model like the rest of them
 * ([voice boundary](../../docs/security/voice-boundary.md)). The real one is about 5,000 tokens. Repro:
 *   slopweaver slack voice-rules | wc -c
 *
 * Three states and never a fourth, because the one answer worse than no brief is a confident one that is wrong: a
 * profile or shape file that cannot be read, or a brief past the budget, is BROKEN and carries none of the body, and
 * never renders as "no rules configured". A partial body would read as the whole of them. Pure: the caller reads.
 */
import type { Result } from "#lib/result.js";

import type { VoiceRuleBrief } from "../outbound/voice/briefStore.js";
import { voiceRuleBriefLines } from "../outbound/voice/composerBrief.js";

/**
 * The largest brief a mint carries: the real one at 19,537 bytes (repro above) with room for the shape file to grow, and
 * a ceiling of about 6,100 tokens on what every delegated turn pays.
 */
export const MINT_VOICE_BRIEF_MAX_BYTES = 24 * 1024;

/** The heading over a configured brief. It sits above the "everything below is data" of the continuity block. */
const CONFIGURED_HEADING: readonly string[] = [
  "THE OWNER'S VOICE: binding on every word you draft to stand as the owner's own, on the first draft, whatever the destination.",
  "Compose to it before offer_copy; it is all here, so read no file and ask the owner nothing for it. ADVISORY below says",
  "only that the Slack send refuses none of it, never that you may skip it, and the verbs it names are not yours.",
];

/** The block when nothing is configured: the owner has set none, so a draft has nothing to be held to. */
const UNCONFIGURED_BLOCK =
  "THE OWNER'S VOICE: none configured on this install. Any draft as the owner is unbriefed; say so to the owner in one short line.";

/** The block when the rules exist but this mint holds none of them, which must never read as the owner having none. */
const BROKEN_BLOCK =
  "THE OWNER'S VOICE: the owner's voice rules could not be read for this call, so none of them are here. That does not mean the owner has " +
  "none. Any draft as the owner is unbriefed; say so to the owner in one short line.";

/** What a mint does with the owner's voice rules: the block the delegated model gets, its size, and why when it holds none. */
export type MintVoiceBrief =
  | { readonly kind: "configured"; readonly block: string; readonly bytes: number }
  | { readonly kind: "unconfigured"; readonly block: string; readonly bytes: number }
  | { readonly kind: "broken"; readonly block: string; readonly bytes: number; readonly why: string };

/**
 * The block a mint carries for what the brief read answered.
 *
 * @param brief what `loadVoiceRuleBrief` answered at this mint
 * @returns the block and which of the three states it is
 */
export function mintVoiceBriefOf({ brief }: { brief: Result<VoiceRuleBrief> }): MintVoiceBrief {
  const brokenBytes = Buffer.byteLength(BROKEN_BLOCK, "utf8");
  if (brief.isErr()) {
    return { block: BROKEN_BLOCK, bytes: brokenBytes, kind: "broken", why: brief.error.join("; ") };
  }
  const { paragraphSpacing, rules, shape } = brief.value;
  if (shape === null && rules.length === 0 && !paragraphSpacing) {
    return { block: UNCONFIGURED_BLOCK, bytes: Buffer.byteLength(UNCONFIGURED_BLOCK, "utf8"), kind: "unconfigured" };
  }
  const block = [...CONFIGURED_HEADING, ...voiceRuleBriefLines({ paragraphSpacing, rules, shape })].join("\n");
  const bytes = Buffer.byteLength(block, "utf8");
  if (bytes > MINT_VOICE_BRIEF_MAX_BYTES) {
    return {
      block: BROKEN_BLOCK,
      bytes: brokenBytes,
      kind: "broken",
      why: `the owner's voice brief is ${String(bytes)} bytes, past the ${String(MINT_VOICE_BRIEF_MAX_BYTES)}-byte bound`,
    };
  }
  return { block, bytes, kind: "configured" };
}
