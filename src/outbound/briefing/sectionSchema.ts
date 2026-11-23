/**
 * What a collapsed section below the line may hold — the `history` entries, `earlierToday`, and the one
 * projected section that carries a fixed id.
 *
 * Its own module because `./schema.ts` is the whole form's contract and had grown past the length at which
 * a reader holds a file in their head (the `file-size-ratchet` gate's line, and its own reasoning: a file
 * nobody can hold is one nobody reviews). A section is a real seam rather than an arbitrary cut — it is the
 * one shape the form repeats, and the only one parameterised by which id it may carry.
 */
import { z } from "zod";

import { SECTION_MAX_NOTES } from "../../briefing/caps.js";
import { strictForm } from "../strictForm.js";
import { FIXED_SECTION_IDS, FRESHNESS_SECTION_ID, NOTHING_STALE_SECTION_ID } from "./types.js";
import { foldedNoteSchema, foldSummary, quotedNoteSchema, sectionId } from "./vocabulary.js";

/**
 * What a section may hold. Bounded, because a fold costs bytes even when it costs no words above the fold
 * — see `SECTION_MAX_NOTES` for the 489-note, 690 KB page that taught this.
 *
 * Two ARMS, because a section below the line is where a projection of the owner's own recorded words lands
 * (`../../briefing/narrative.ts`). A note carrying no `lane` is the composed one every existing form
 * writes and is validated exactly as it always was; `lane: "quoted"` swaps the detail's fold for the
 * quoted one. Both are `strictForm`s, so an unknown lane matches neither arm and is refused.
 */
const sectionNotesSchema = z
  .array(z.union([quotedNoteSchema, foldedNoteSchema]))
  .min(1)
  .max(SECTION_MAX_NOTES, {
    message:
      `a section holds at most ${String(SECTION_MAX_NOTES)} notes; the page was 690 KB with 489 of them. ` +
      "Run `slopweaver briefing archive --form <path>` to move the oldest notes into a dated archive " +
      "file, then render again.",
  });

/** One section's own shape, parameterised by the one fixed id — if any — that section is allowed to carry. */
const sectionSchemaFor = ({ ownId }: { ownId?: string } = {}) =>
  strictForm({
    id: sectionId
      .refine((id) => id === ownId || !FIXED_SECTION_IDS.includes(id), {
        message: `a section id may not be one the renderer already emits: ${FIXED_SECTION_IDS.join(", ")}.`,
      })
      .optional(),
    notes: sectionNotesSchema,
    summary: foldSummary,
  });

/** A composer-written section: it may mint an id, and may not take one the renderer already emits. */
export const sectionSchema = sectionSchemaFor();

/**
 * The freshness section, which carries its OWN fixed id and is the one section allowed to.
 *
 * It is projected rather than composed (`../../briefing/freshness.ts`), so the id is the renderer's rather
 * than anybody's choice — and it has to be a fixed id, because a react-now card anchors to it.
 */
export const freshnessSectionSchema = sectionSchemaFor({ ownId: FRESHNESS_SECTION_ID });

/**
 * The "Nothing stale" section, projected by `../../briefing/nothingStale.ts` under its own fixed id — which
 * validates what it builds against this before it ever reaches a form.
 */
export const nothingStaleSectionSchema = sectionSchemaFor({ ownId: NOTHING_STALE_SECTION_ID });

/**
 * Every projected section the whole form accepts, spread into it as one entry so the form's own contract
 * names them in one place. Each is accepted because a projection splices it into the same parsed document a
 * composer wrote; `../../cli/commands/briefing/injectSections.ts` is what refuses a composer who filled one in.
 */
export const projectedSectionFields = {
  freshness: freshnessSectionSchema.optional(),
  nothingStale: nothingStaleSectionSchema.optional(),
};
