/**
 * The one conversion from this repository's attachment wrapper to the SDK's. A leaf with no dependency back on
 * `./writeApi.ts`, so every write-call module beside it can import it rather than keep its own copy.
 */
import type { MessageAttachment } from "@slack/types";

import type { SlackCardWrapper } from "../../outbound/slack/types.js";

/**
 * A wrapper as the SDK's mutable `MessageAttachment`. Our payload types are deeply `readonly` so the pure
 * renderer's output cannot be edited in place; the SDK wants mutable arrays. One shallow copy at the
 * boundary is the honest conversion — and it is the SAME conversion for the card, the answer, the turn frame
 * and the recipe response, since {@link SlackCardWrapper} is the one wrapper shape every accent-coloured
 * message shares.
 *
 * @param wrapper the wrapper to convert
 * @returns the SDK's mutable attachment array, of length one
 */
export function toSdkAttachments({ wrapper }: { wrapper: SlackCardWrapper }): MessageAttachment[] {
  return [{ blocks: [...wrapper.blocks], color: wrapper.color, fallback: wrapper.fallback }];
}
