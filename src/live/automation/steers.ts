/**
 * The owner's recorded steers over stopped recipe rows — a choice the owner has already made, so no card asks it
 * again.
 *
 * `recipe-stopped` puts a row that went quiet on the owner's screen until a seat takes its repair. For a whole
 * class of rows the owner has already said who seats it, and carding it again is the defect this file closes.
 * MEASURED: one `monitor check --fire` put _"Choose restart, repair, or retire for 43 recipes, worst
 * resync-atlas-github"_ on the owner's screen, 41 of the 43 `resync` rows.
 *
 * A steer is a DECLARATION here rather than a row the owner writes, because each one is a ruling already on record
 * with an anchor a reader can check, and the class it covers is a field of the definition rather than a list of
 * ids — an atlas registered tomorrow is covered the moment `automation register-resyncs` writes its row.
 *
 * A steer answers the CHOICE, never the silence. The `recipe-stopped` card asks no choice at all, so a covered row
 * stays on it: MEASURED, while a steer kept a row off that card, 22 stopped `resync-atlas-*` rows reached the owner
 * no way at all. What the steer still carries is the row's `steerId`, the chair's word on who seats it. A covered
 * row that cannot run unattended still needs the owner's hand, and says so through `automation blocker`.
 *
 * Pure: declarations and a lookup. No I/O.
 */
import { canonicalNoun } from "../../cli/nounAliases.js";
import type { RecipeDefinition } from "./definition.js";
import { RESYNC_KIND } from "./kinds.js";
import { planVerbRun, VERB_RUN_KIND } from "./verbRun.js";

/** What the owner chose for the rows a steer covers. Only `restart` is on record; a retire is a `hold` instead. */
type RecipeSteerDecision = "restart";

/** One recorded ruling that already answers the restart/repair/retire question for a class of rows. */
export interface RecipeSteer {
  /** The ruling's own number, as the canon cites it. */
  readonly id: string;
  /** Where the ruling is recorded, checkable in one read. */
  readonly anchor: string;
  /** The rule the steer states, paraphrased. */
  readonly words: string;
  readonly decision: RecipeSteerDecision;
  /** What the fleet does about a covered row instead of asking the owner — the chair's move, in one clause. */
  readonly instead: string;
  /** Whether this steer covers a row, judged off the parsed definition — its `kind`, never its id's spelling. */
  readonly covers: (options: { definition: RecipeDefinition }) => boolean;
}

/** Whether a `verb-run` row runs `automation resync` — the shape a compile-only atlas's managed row is written in. */
function runsTickResync({ definition }: { definition: RecipeDefinition }): boolean {
  if (definition.kind !== VERB_RUN_KIND) {
    return false;
  }
  const plan = planVerbRun({ definition });
  if (plan.isErr()) {
    return false;
  }
  // A row's argv is persisted, written `recipe resync` by every build so far, and either noun runs it.
  const [noun, verb] = plan.value.argv;
  return noun !== undefined && canonicalNoun({ noun }) === "automation" && verb === "resync";
}

/** Every steer on record, first match wins. */
export const RECIPE_STEERS: readonly RecipeSteer[] = [
  {
    anchor: "src/cli/commands/automation/registerResyncs.ts: the rows the recipe page says survive, survive",
    // Either managed kind: a compile-only atlas's row is written on `verb-run` and is just as much one of the
    // scheduled resyncs the owner asked for. The ARGV decides that, read through the planner, never the id's spelling.
    covers: ({ definition }) => definition.kind === RESYNC_KIND || runsTickResync({ definition }),
    decision: "restart",
    id: "resync-restart",
    instead:
      "the chair seats it, or runs it in its own tick when it is a compile-only atlas, and one " +
      "needing the owner's hand carries a `automation blocker` with its steps",
    words:
      "A stale atlas is resynced rather than asked about, because resyncs are scheduled across every atlas and " +
      "corpus.",
  },
];

/**
 * The steer that already answers this row, if any.
 *
 * @param definition the parsed row
 * @returns the first steer covering it, or `undefined` when the choice is still the owner's
 */
export function steerFor({ definition }: { definition: RecipeDefinition }): RecipeSteer | undefined {
  return RECIPE_STEERS.find((steer) => steer.covers({ definition }));
}
