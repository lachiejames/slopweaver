/**
 * The failure a seat taking a failed row's card should put into plain words, and the exact command that does it.
 *
 * A firing no visible session watched — one the supervisor tick ran in-process, say — keeps its card's fixed sentence
 * until somebody explains it, and the somebody is the NEXT VISIBLE SESSION, when it picks the card up. No model runs
 * outside a session the owner can see (AGENTS.md rule 2). The card is the failure's own p0 finding, and the seat picks it up
 * with `automation repair <recipeId> --row <finding>`, so that verb prints this.
 *
 * **The firing is the one the card names, never the row's newest.** A finding's slug is derived from its recipe, slot
 * and attempt (`../live/automation/failureHold.ts`'s `failureFindingSlug`), so the firing is found by deriving each
 * failed firing's slug and matching the taken row — the hashed form included, which no parse could reverse. Two
 * findings for one row (a hold that did not write lets it fire again) each prompt for their own firing, and no
 * ordering rule stands between the card and its words.
 */
import { resolve } from "node:path";

import { printableOneLine as oneLine } from "#lib/oneLineSummary.js";
import { shellCommandLine } from "#lib/shellCommandLine.js";

import { explanationKey } from "../live/automation/failureExplanation.js";
import { failureFindingSlug } from "../live/automation/failureHold.js";
import type { FiringView } from "./card.js";

/**
 * The failed or dead firing whose own finding is `row`, or `null` when no firing the ledger holds as failed derives
 * that slug: the row is not a failure finding, or its slot was retried onto another attempt since.
 *
 * @param row the board row the seat took
 * @param firings every firing the slot ledger holds for the recipe
 * @returns the firing the row's card names, or `null`
 */
export function findingFiring({
  recipeId,
  row,
  firings,
}: {
  recipeId: string;
  row: string;
  firings: readonly FiringView[];
}): FiringView | null {
  const named = firings.find(
    (firing) =>
      (firing.outcome === "failed" || firing.outcome === "dead") &&
      failureFindingSlug({ attempt: firing.attempt, recipeId, slotIso: firing.slotIso }) === row,
  );
  if (named === undefined) {
    return null;
  }
  return named;
}

/**
 * What `automation repair` says about the failure the taken row names: that it names none, that a session already put
 * it in plain words, or the firing, what it recorded and the exact `automation explain` command — `--home` included,
 * so it writes to the store the take read — whose sentence then leads its card.
 *
 * @param row the board row the seat took
 * @param home the state home the take read, which the printed command must write to
 * @param firings every firing the slot ledger holds for the recipe, read whole
 * @param explanations the recipe's sentences by firing key, from a register read whole
 * @returns the lines to print
 */
export function unexplainedFailureLines({
  recipeId,
  row,
  home,
  firings,
  explanations,
}: {
  recipeId: string;
  row: string;
  home: string;
  firings: readonly FiringView[];
  explanations: ReadonlyMap<string, string>;
}): readonly string[] {
  // Every value read off a store is folded to one line: a newline in it would print as a line of its own, a command
  // included. The command itself is shell-quoted whole instead.
  const recipe = oneLine({ text: recipeId });
  const firing = findingFiring({ firings, recipeId, row });
  if (firing === null) {
    return [
      `automation repair · ${recipe} · no failed firing in the slot ledger is the one ${oneLine({ text: row })} names, so there is none to explain here`,
    ];
  }
  const named =
    `${recipe} · the failure ${oneLine({ text: row })} names, firing ${oneLine({ text: firing.slotIso })} ` +
    `attempt ${String(firing.attempt)}`;
  if (explanations.has(explanationKey(firing))) {
    return [`automation repair · ${named}, already reads in plain words`];
  }
  // Absolute, so the command reads the same store from any directory a seat runs it in, and a relative home such as
  // `--state` can never print as a flag.
  const absoluteHome = resolve(home);
  const recorded = firing.reason === null ? [] : [`  what it recorded: ${oneLine({ text: firing.reason })}`];
  const ask = `automation repair · ${named}, has no plain sentence — no session explained it, so this one does, once it has read why:`;
  // The id never opens with `-`: the definition schema refuses one, since a verb would read it as a flag.
  const command = shellCommandLine({
    command: [
      "slopweaver",
      "automation",
      "explain",
      recipeId,
      "--slot",
      firing.slotIso,
      "--attempt",
      String(firing.attempt),
      "--home",
      absoluteHome,
    ],
  });
  return [ask, ...recorded, `  ${command} --why "<what broke, so what fixes it.>"`];
}
