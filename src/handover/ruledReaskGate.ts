/**
 * The gate `handover ask` meets when its question is one the owner already ruled on, word for word, in this run.
 *
 * Whoever re-asks it, that is the stale card the owner told the fleet to stop putting in front of them, and the Queue already draws it as a check-in carrying
 * their ruling (`./heldQuestion.ts`'s `rulingBeforeRepeatedQuestion`). A re-ask that needs the owner again says what
 * changed since their ruling, and then its words differ — so the refusal tells the asking session exactly that, before
 * the journal is touched.
 *
 * Pure: the caller supplies the run's events, the question, the instant and the environment.
 */

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { rulingBeforeRepeatedQuestion } from "./heldQuestion.js";
import type { RunEvent } from "./ledger.js";

/**
 * The environment variable that records a re-ask this gate refuses.
 *
 * A LITERAL rather than `hatchEnvVar({ suffix })`: `escape-hatch` in `yarn lint` checks that a row's named
 * reader mentions its own key, and a name assembled at runtime is one no static scan can see.
 */
export const RULED_REASK_HATCH = "SLOPWEAVER_ALLOW_RULED_REASK";

/** What `handover ask` should do with the question it was handed. */
export type RuledReaskVerdict =
  | { readonly kind: "ok" }
  /** Not recordable. `lines` is whole — the caller prints it and adds nothing. */
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/**
 * The verdict on a question about to be asked, judged as though its `question` line were already appended.
 *
 * @param events the run's journal as it stands before the ask
 * @param question the `--question` text, trimmed as the verb records it
 * @param askedIso the instant the ask would be recorded at
 * @param command the door being refused, as the owner would type it
 * @param env the process environment, for the hatch
 * @returns `ok`, or the whole refusal to print
 */
export function ruledReaskVerdict({
  events,
  question,
  askedIso,
  command,
  env,
}: {
  events: readonly RunEvent[];
  question: string;
  askedIso: string;
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): RuledReaskVerdict {
  const asked: RunEvent = { atIso: askedIso, kind: "question", question };
  const ruling = rulingBeforeRepeatedQuestion({ askedIso, events: [...events, asked], question });
  if (ruling === undefined || env[RULED_REASK_HATCH] === "1") {
    return { kind: "ok" };
  }
  const hatch = { ...hatchFor({ id: "ruled-reask" }), command };
  return {
    kind: "refused",
    lines: [
      hatchRefusal({ hatch }),
      `  - the owner ruled on this question in these words at ${ruling.decidedIso} (${ruling.anchor}): "${ruling.words}"`,
      "  - say what changed since their ruling, in the question itself — a re-ask in the same words is drawn as a " +
        "check-in carrying their ruling, never a fresh question",
      "NOTHING was recorded and the run is not paused, so reword the question with what changed and ask again.",
    ],
  };
}
