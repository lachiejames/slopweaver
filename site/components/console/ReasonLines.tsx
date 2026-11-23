"use client";

/**
 * A Queue card's refusal or a held card's check, drawn from its `ReasonWords` (`../../lib/quotedReason.ts`): the
 * console's own sentence as itself, or each quoted read's reason said plainly under the console's lead with the raw
 * message folded beneath. Its own component so every Queue surface that draws a refusal
 * places the fold the same way — each in a `<div>`, since a `<p>` cannot hold the fold's `<details>`.
 */
import type { ReactElement } from "react";

import { leadBeforeReason, type ReasonWords } from "../../lib/quotedReason";
import { InlineText } from "./InlineText";
import { PlainWhy } from "./RawFold";

/**
 * A reason as the page draws it: the console's words inline, or each quoted read's reason as its own block.
 *
 * @param reason the console's sentence, or the reads' reasons it quotes
 * @param known the pull-request URLs a card publishes, so its sentence's citations link; a surface that never linked
 *   them passes none, and its sentence stays plain text
 * @returns the reason's lines
 */
export function ReasonLines({ reason, known }: { reason: ReasonWords; known?: readonly string[] }): ReactElement {
  if (typeof reason === "string") {
    if (known === undefined) {
      return <>{reason}</>;
    }
    return <InlineText text={reason} known={known} />;
  }
  // A card that links its citations links them in a quoted lead too, exactly as in a single-sentence reason; the
  // read's own reason is never chipped.
  return (
    <>
      {reason.map((quoted, at) => (
        <div key={`${String(at)}:${quoted.lead}`}>
          {known === undefined ? (
            <PlainWhy lead={quoted.lead} why={quoted.why} />
          ) : (
            <>
              <InlineText text={leadBeforeReason({ lead: quoted.lead })} known={known} />
              <PlainWhy why={quoted.why} />
            </>
          )}
        </div>
      ))}
    </>
  );
}
