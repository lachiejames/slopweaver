/**
 * The recipe-due source of `slopweaver supervisor tick-draft`: the `automation due --json` slice turned into the
 * due asks the tick records. Split from `./tickDraftSources.ts` when the declared-automation roster joined it,
 * along the seam `./tickCapacityDraft.ts` and `./tickGaugeDraft.ts` already cut: everything here reads the due
 * document.
 */
import {
  datedInstant,
  documentWitness,
  dueRowsOf,
  observationOf,
  parseDocument,
  recipeDueSlice,
  type SourceMapper,
  unavailableObservation,
} from "./tickDraftShapes.js";
import type { RecipeDueFacts, SourceObservation } from "./tickTypes.js";

/**
 * One note naming every declared automation in one state, or none when the list is empty.
 *
 * @param ids the recipe ids `automation due` listed
 * @param state what is wrong with each, as the note says it
 * @returns zero or one note
 */
function declarationNote({ ids, state }: { ids: readonly string[]; state: string }): readonly string[] {
  if (ids.length === 0) {
    return [];
  }
  return [`${String(ids.length)} declared automation(s) ${state}: ${ids.join(", ")}`];
}

/**
 * The due asks: every due row the tick schema can hold, held ones included, and the rest named.
 *
 * @returns the due observation, or the refusal of a document that is not `automation due --json`'s
 */
export const recipeDueObservation: SourceMapper<RecipeDueFacts> = ({ capture, frame }) =>
  parseDocument({ capture, kind: "recipeDue", schema: recipeDueSlice }).map(
    (report): SourceObservation<RecipeDueFacts> => {
      const instant = datedInstant({ capture, documentIso: report.nowIso, frame, kind: "recipeDue" });
      if (instant.stale !== undefined) {
        return instant.stale;
      }
      const witness = documentWitness({ dated: true, kind: "recipeDue", path: capture.path });
      const due = dueRowsOf({ rows: report.rows });
      const rejected = report.rejected.length > 0 ? [`${String(report.rejected.length)} definition(s) rejected`] : [];
      const declared = [
        ...declarationNote({ ids: report.missing.map((row) => row.recipeId), state: "absent from the store" }),
        ...declarationNote({ ids: report.superseded.map((row) => row.recipeId), state: "on a superseded cadence" }),
      ];
      const notes = [...declared, ...rejected, ...due.notes];
      // Every due row dropped is not "nothing is due": an empty list is what a reader of the page sees as a
      // quiet schedule, and the diagnostic beside it does not undo that. A partial reading is only honest
      // while something survived to be partial ABOUT — and a roster whose definitions ALL failed to parse
      // establishes nothing about the schedule either, which is the same emptiness by another route. So does
      // a declared automation the store does not hold: MEASURED once, all twenty were absent and the
      // briefing said "nothing due".
      if (due.rows.length === 0 && notes.length > 0) {
        return unavailableObservation({
          diagnostic: `no due ask could be recorded from ${capture.path}, so this tick knows of none: ${notes.join("; ")}`,
          observedAtIso: instant.observedAtIso,
          witness,
        });
      }
      return observationOf({
        facts: { rows: due.rows },
        notes,
        observedAtIso: instant.observedAtIso,
        verbatimLine: undefined,
        witness,
      });
    },
  );
