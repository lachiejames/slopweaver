/**
 * The Slack NO-FOLD renderer — one top-level block, no attachment wrapper, and therefore no "Show more".
 *
 * ## The mechanism, and the claim this repository had to retract
 *
 * `./render.ts` and `./preview.ts` both stated, from a twelve-variant matrix, that **the fold is a function
 * of BLOCK COUNT ALONE: more than five blocks folds**. That is refuted. The message that forced this whole
 * form is a THREE-block attachment — `context`, `divider`, `section`, no `Details` label — and it renders
 * "Show more" in the owner's client. Read it back and count:
 *
 * ```bash
 * slopweaver slack read-thread <the permalink of the folded policy DM in the owner's own bot DM>
 * ```
 *
 * Length alone does not replace it either: about 500 visible characters folded and 480 did not, which is a
 * bracket around a number nobody has measured, not a threshold. So this form does not encode one.
 *
 * What SURVIVES from that matrix is the other half, recorded in `./types.ts`: **the legacy `attachments[]`
 * wrapper is what makes the fold work — the identical blocks posted at TOP LEVEL do not fold.** The as-me
 * lane posts top level and has never folded a message. So the primitive is structural: no wrapper, and one
 * block. {@link SlackNoFoldPayload} makes both of those unrepresentable rather than merely intended — there
 * is no `attachments` key on the type at all, and `blocks` is a one-element TUPLE.
 *
 * **Two claims, and only one of them is enforced here.** What this module GUARANTEES is the payload
 * STRUCTURE: no wrapper, one `rich_text` block, checked by the type and again by
 * {@link noFoldPayloadIssues}. What was OBSERVED is that a message of this structure rendered without
 * "Show more" in one client, in one window — photographed at
 * `$SLOPWEAVER_HOME/proof/no-fold-slack-schema/no-fold-proof-12sep-1121.png`, with two attachment cards
 * folding in the same frame as the positive control. That is strong evidence and it is not a proof about
 * every client at every width, so do not quote the structure as if it were one. The honest sentence is:
 * this carries no wrapper, and a wrapper is the only fold cause anything here has measured.
 *
 * ## The price, stated rather than discovered
 *
 * The violet bar is `SlackCardWrapper.color`, and the author row is a block inside the wrapper. A message
 * with no wrapper has neither. Slack's own message header still says who sent it, so the bot is not
 * anonymous — but a no-fold message does not look like the card, and it cannot. That is the trade: identity
 * chrome for a guarantee that nothing is hidden. This form has no below-the-fold: everything sits above
 * the fold.
 *
 * Dropping the author row is also a SIZE decision and not only an unavoidable one. Every character of a
 * no-fold message is a character a reader cannot skip, so the chrome that a card can afford — an emoji, a
 * repeated bot name, a `Details` label — is exactly what this form should not spend height on.
 */
import type { KnownBlock, RichTextBlock, RichTextSection } from "@slack/types";

import { isRecord } from "../../lib/parsers.js";
import type { NoFoldArtifact, NoFoldInlineRun } from "../artifact/types.js";
import { quoteMarkedLines } from "./blockquote.js";
import { redactWrapper } from "./piiRedaction.js";
import { type ResolvedMentions, renderRun } from "./render.js";
import type { SlackNoFoldMetadata, SlackNoFoldPayload } from "./types.js";

/**
 * The separator between the lead and what follows, and between trailing lines.
 *
 * The same measured fact `./render.ts`'s `PARAGRAPH_GAP` rests on: block structure creates NO spacing, and
 * sibling sections inside one block render identically to adjacent blocks, so the blank line has to be an
 * embedded character. It is emitted as its own text element rather than appended to the preceding run so it
 * still works when a line ends in a link or a mention rather than in text.
 */
const PARAGRAPH_GAP = "\n\n";

/**
 * The separator after a bullet list.
 *
 * A list already ends with its own break, so a full {@link PARAGRAPH_GAP} on top of it renders too large
 * (probe H3) and none renders too tight (probe I1). One newline is what looked right (probe I2) — the same
 * three probes `./render.ts`'s `AFTER_LIST_GAP` cites, reused rather than re-measured.
 */
const AFTER_LIST_GAP = "\n";

/**
 * The renderer name stamped into metadata, so a later reader can tell which form produced a message.
 *
 * Exported because it is a TARGET check as well as a stamp: `slack edit` refuses a message this names,
 * because that verb re-renders as a card and would wrap it in the attachment a no-fold message must never
 * have. Checking the incoming FORM's kind is not enough — the hole that check leaves is a valid `update`
 * form aimed at a no-fold message's own timestamp.
 */
export const NO_FOLD_RENDERER = "slack-no-fold-v1";

/**
 * One run sequence as a section, with an optional separator embedded at its end.
 *
 * @param runs the no-fold run sequence
 * @param mentions identity-map keys already resolved to Slack user ids
 * @param trail the separator to embed after the line, or the empty string for none
 * @returns the section
 */
function noFoldSection({
  runs,
  mentions,
  trail,
}: {
  runs: readonly NoFoldInlineRun[];
  mentions: ResolvedMentions;
  trail: string;
}): RichTextSection {
  const elements = runs.map((run) => renderRun({ citations: [], mentions, run }));
  return {
    elements: trail === "" ? elements : [...elements, { text: trail, type: "text" }],
    type: "rich_text_section",
  };
}

/**
 * The single `rich_text` block a no-fold message is.
 *
 * Everything is in ONE block on purpose: the lead as a section, the dot points as a `rich_text_list` inside
 * the same block, and each trailing line as a further section. Grouping a list with sections in one block is
 * the same thing `./render.ts`'s `renderDetail` and `renderLeadBlock` already do, so it is not a new claim
 * about Slack — only the one place where it is the whole point rather than an optimisation.
 *
 * @param artifact the validated no-fold artifact
 * @param mentions identity-map keys already resolved to Slack user ids
 * @returns the one block
 * @internal
 */
function renderNoFoldBlock({
  artifact,
  mentions,
}: {
  artifact: NoFoldArtifact;
  mentions: ResolvedMentions;
}): RichTextBlock {
  const hasBullets = artifact.bullets.length > 0;
  const hasTrailing = artifact.trailing.length > 0;
  const leadTrail = hasBullets || hasTrailing ? PARAGRAPH_GAP : "";
  const elements: RichTextBlock["elements"] = [noFoldSection({ mentions, runs: artifact.lead, trail: leadTrail })];
  if (hasBullets) {
    elements.push({
      elements: artifact.bullets.map((runs) => noFoldSection({ mentions, runs, trail: "" })),
      style: "bullet",
      type: "rich_text_list",
    });
  }
  artifact.trailing.forEach((runs, index) => {
    const last = index === artifact.trailing.length - 1;
    // The FIRST trailing line follows the list, so it needs the tighter after-list gap in FRONT of it —
    // which is spent by the list itself ending a line. Everything after it is an ordinary paragraph.
    const leading = index === 0 && hasBullets ? AFTER_LIST_GAP : "";
    elements.push(
      noFoldSection({
        mentions,
        runs: leading === "" ? runs : [{ text: leading, type: "text" }, ...runs],
        trail: last ? "" : PARAGRAPH_GAP,
      }),
    );
  });
  return quoteMarkedLines({ block: { elements, type: "rich_text" } });
}

/**
 * The NOTIFICATION fallback — the push notification, the sidebar preview and the screen reader's copy.
 *
 * Built from the LEAD's visible text alone. With `blocks` present Slack renders the blocks and uses `text`
 * only for those three surfaces, so this is not a second copy of the message; a fallback carrying the dot
 * points would read as a duplicate in every preview that shows both.
 *
 * @param artifact the validated no-fold artifact
 * @returns the lead's visible text, with a link rendered as its label
 */
export function noFoldFallback({ artifact }: { artifact: NoFoldArtifact }): string {
  return artifact.lead
    .map((run) => {
      if (run.type === "text") {
        return run.text;
      }
      if (run.type === "link") {
        return run.label;
      }
      return "";
    })
    .join("")
    .trim();
}

/**
 * Render a `no-fold` artifact into the Slack message that cannot fold.
 *
 * @param artifact the validated artifact
 * @param mentions identity-map keys already resolved to Slack user ids
 * @param artifactFingerprint the stable content hash recorded in metadata
 * @param metadataEventType the operator's own `metadata.event_type`, from profile.json
 * @returns the exact `chat.postMessage` arguments, minus the channel
 */
export function renderNoFoldMessage({
  artifact,
  mentions,
  artifactFingerprint,
  metadataEventType,
}: {
  artifact: NoFoldArtifact;
  mentions: ResolvedMentions;
  artifactFingerprint: string;
  metadataEventType: string;
}): SlackNoFoldPayload {
  const metadata: SlackNoFoldMetadata = {
    event_payload: {
      artifactFingerprint,
      artifactKind: "no-fold",
      renderer: NO_FOLD_RENDERER,
      schemaVersion: 1,
    },
    event_type: metadataEventType,
  };
  // The PII pass a card's wrapper crosses (`./piiRedaction.ts`), over the WHOLE payload:
  // the one block and the notification `text`, which is a second copy of the lead. Every automation prompt
  // posts through this renderer, so skipping it left the one lane with no fold also the one with no redaction.
  return redactWrapper({
    wrapper: {
      blocks: [renderNoFoldBlock({ artifact, mentions })],
      metadata,
      text: noFoldFallback({ artifact }),
      unfurl_links: false,
      unfurl_media: false,
    },
  });
}

/**
 * Every reason a payload about to go on the wire would NOT be a no-fold message.
 *
 * The one predicate, and it is checked over the RENDERED payload rather than over the form — because the
 * form is not what Slack sees. It exists for the case the type system cannot reach: a payload assembled
 * somewhere else, widened by a later edit, or handed to the transport as `unknown`. On the ordinary path it
 * finds nothing, and that is the intended reading: {@link SlackNoFoldPayload} already makes both failures
 * unrepresentable, so this is the runtime witness that the type is still telling the truth.
 *
 * **Prove it can fire before quoting it as a check.** Hand it a payload carrying an `attachments` key, or a
 * second block, and read the issues back — `src/__tests__/unit/outbound/slack/noFold.test.ts` does exactly
 * that, because a check that cannot fail reports clean forever.
 *
 * @param payload the rendered message, exactly as it would be posted
 * @returns one line per violation, empty when the payload cannot fold
 */
export function noFoldPayloadIssues({ payload }: { payload: SlackNoFoldPayload }): readonly string[] {
  const issues: string[] = [];
  // Read through a GUARD rather than off the type. The whole value of this check is for a payload whose
  // static type has stopped being the truth — widened by a later edit, or assembled somewhere else — so it
  // has to be able to see a property the type says cannot exist. A guard checks that; an assertion would
  // only assert it, which is the thing this function exists to stop trusting.
  if (isRecord(payload) && payload["attachments"] !== undefined) {
    issues.push(
      "this no-fold message carries an `attachments` wrapper, which is the one thing MEASURED to make " +
        "Slack fold a message at all — the identical blocks at top level do not fold. Nothing may add one.",
    );
  }
  const blocks: readonly KnownBlock[] = payload.blocks;
  if (blocks.length !== 1) {
    issues.push(
      `this no-fold message carries ${String(blocks.length)} blocks; a no-fold message is exactly ONE. ` +
        "Every line of it belongs in that block's own elements, which is where the renderer puts them.",
    );
  }
  blocks.forEach((block, index) => {
    if (block.type !== "rich_text") {
      issues.push(
        `block ${String(index)} is a \`${block.type}\`; a no-fold message is one \`rich_text\` block. A ` +
          "`section`, a `context` or a `divider` here is chrome this form deliberately does not have.",
      );
    }
  });
  return issues;
}
