/**
 * Provenance: who raised the thing a row is about — the fleet, a review bot, or a colleague.
 *
 * The row icon states provenance (Slopweaver-found, CodeRabbit, the team). No
 * register carries a provenance field, so it is read off the facts a row already has, and the rule is
 * stated on the glyph's title so a reader can check it. `conversations.codeRabbit` on a landing row counts
 * EVERY bot's threads (`src/review/reviewSignals.ts`), so the class is "bot", labelled by the one that opens
 * nearly all of them. The two non-bot classes are the workspace ROLES (`./workspacePlacement.ts`), never names.
 */

import type { WorkspacePlacement } from "./workspacePlacement";
import { workspaceOfPlacement } from "./workspacePlacementContext";

/** The three classes, and nothing finer: a fourth would be a guess. */
export type Provenance = "self" | "bot" | "team";

/** What one class prints: its label, the rule that put a row there, and the letters for a class with no mark. */
export interface ProvenanceEntry {
  readonly glyph?: string;
  readonly label: string;
  readonly rule: string;
}

/** The rule that puts a row in each class — the same whoever the organisation is. */
const RULES: Readonly<Record<Provenance, string>> = {
  bot: "a review bot's thread is waiting on us, or the next act is a bot-review fix",
  self: "a card or pull request drawn in this installation's own workspace",
  team: "a card or pull request drawn in the team's workspace",
};

/**
 * What a class prints. `self` draws the Slopweaver logo and `team` a role mark (`components/live/PrCard.tsx`); `bot`
 * has no mark, so it prints the letters of the bot that opens nearly all its threads. The team class is labelled by
 * the organisation the install works for, the same name the context switcher shows (`./placementOrganisation.ts`).
 *
 * @param teamLabel the team context's name: the organisation's display name, off the layout's one reading
 * @returns the entry
 */
export function provenanceEntryOf({
  provenance,
  teamLabel,
}: {
  provenance: Provenance;
  teamLabel: string;
}): ProvenanceEntry {
  if (provenance === "bot") {
    return { glyph: "CR", label: "CodeRabbit", rule: RULES.bot };
  }
  if (provenance === "self") {
    return { label: "Slopweaver", rule: RULES.self };
  }
  return { label: teamLabel, rule: RULES.team };
}

/** The facts of a landing row the bot class reads; whose workspace it is comes from its placement alone. */
export interface ProvenanceFacts {
  readonly action: string;
  readonly botAwaitingUs: number;
}

/**
 * The provenance of a pull request row: the bot class when a review bot's thread waits on us or the next act is a
 * bot-review fix (`spawn-coderabbit`), as {@link RULES} prints, and otherwise the workspace its placement draws it in, read through the ONE rule {@link queueProvenanceOf} reads. A separate
 * facts-only rule once gave a pull request the self view drew the team's mark, which two views disagreeing about
 * one row's class makes possible.
 *
 * @param placement where the pull request is drawn (`./registerPlacementDirect.ts`'s `prPlacement`)
 * @returns the class, by the rule {@link provenanceEntryOf} prints
 */
export function prProvenanceOf({
  facts,
  placement,
}: {
  facts: ProvenanceFacts;
  placement: WorkspacePlacement;
}): Provenance {
  if (facts.botAwaitingUs > 0 || facts.action === "spawn-coderabbit") {
    return "bot";
  }
  return workspaceOfPlacement({ placement });
}

/**
 * The provenance of a queue row that is not a pull request — an ask, a hand step or an act: it wears the mark of the
 * workspace it is drawn in: an onboarding ask on the Slopweaver view refers to Slopweaver, so it must not wear the
 * team's logo. Read through the ONE placement rule (`workspaceOfPlacement`), never a second one: measured, an unplaced ask
 * wore the team's mark by its own rule while the switcher drew it in Slopweaver, and the owner read a Slopweaver card
 * as the team's; a hand step placed in the team's workspace wore Slopweaver's by a rule of its own.
 *
 * @returns the class
 */
export function queueProvenanceOf({ placement }: { placement: WorkspacePlacement }): Provenance {
  return workspaceOfPlacement({ placement });
}
