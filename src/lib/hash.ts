/**
 * The content-hash helpers. Several judgement-profile modules each need to hash a piece of text into the same
 * tagged `sha256:<hex>` form (self-consistency checks, source manifests, held-out case identity) — one shared
 * implementation, so the tag format cannot drift between them. The policy upload binds its approval digest
 * to the bare hex of the markdown and the PDF, which is {@link sha256Hex}.
 */
import { createHash } from "node:crypto";

/**
 * Hash `text` into the tagged `sha256:<hex>` form this codebase's judgement-profile modules use for content
 * pinning.
 *
 * @param text the text to hash
 * @returns `sha256:<64 lowercase hex chars>`
 */
export function sha256Text({ text }: { text: string }): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/**
 * SHA-256 of some bytes or text, as bare lowercase hex with no tag.
 *
 * @param bytes the exact bytes or text to hash
 * @returns the 64-character hex digest
 */
export function sha256Hex({ bytes }: { bytes: Uint8Array | string }): string {
  return createHash("sha256").update(bytes).digest("hex");
}
