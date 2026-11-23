/**
 * The owner's check-ins as RULES — the acts the fleet took for them and they have not reacted to, grouped the way one
 * word of theirs can settle them — and the acts one spoken reaction settles. Pure: folded acts in, rules or targets out.
 *
 * ## Why a rule is a kind in one place
 *
 * Check-ins pile up by the hundred (about 106 Acme check-ins and 280 Slopweaver ones at one reading), and the owner
 * works through them by developing rulings that clear batches of them. A Queue card is one PATTERN (`groupPatterns`, `./query.ts`)
 * and the owner's word on its newest act settles the card. A ruling reaches further: every card doing the same KIND of thing
 * in the same PLACE, because "the fleet pushed back on CodeRabbit in acme-admin" is one question asked many times,
 * while the same kind of act in another repository is a different team's work and may deserve a different word.
 *
 * ## Why a ruling settles the cards that are there, never a whole kind for ever
 *
 * A class steer (`autonomy steer-class`) is the owner's STANDING word on a kind, and settles every act of it recorded
 * later too. `skills/autonomy/reference/class-steers.md` keeps the kinds the owner still wants asked off every class
 * until they say otherwise, and a reaction spoken while pacing is a word on what the owner was just read, not that. So
 * a ruling here writes the owner's word on the newest act of each pattern it covers, the card they would otherwise be
 * read next, and a later act of the kind still reaches them.
 */
import { err, ok, type Result } from "../lib/result.js";

import { autonomyPatternKeys, groupPatterns, ruleOf, steerOf } from "./query.js";
import { STATE_SUBJECT_PREFIX } from "./subject.js";
import type { AutonomyAction, AutonomyActionRow } from "./types.js";

/** How far one spoken reaction reaches: the card the owner was read, or every card sharing its rule. */
export type RulingCovers = "this" | "rule";

/** The two words a reaction's reach may be given in, in the order a prompt lists them. */
export const RULING_COVERS: readonly RulingCovers[] = ["rule", "this"];

/** One rule: every unsettled card doing the same kind of thing in the same place, its newest act leading. */
export interface CheckInRule {
  /** The act a reaction is about: the newest act of the rule's newest card, its key `act:<actionId>`. */
  readonly lead: AutonomyActionRow;
  /** What kind of thing the fleet did, the act's own `kind`. */
  readonly kind: string;
  /** Where it did it: a GitHub `owner/repo`, a web host, `the board`, or `this machine`. */
  readonly place: string;
  /** How many Queue cards — patterns — the rule holds. */
  readonly cards: number;
  /** How many acts those cards hold between them. */
  readonly acts: number;
}

/** Why a reaction could not be turned into the acts it settles. */
export type CheckInRulingError =
  | { readonly code: "CHECK_IN_UNKNOWN"; readonly message: string; readonly actionId: string }
  | { readonly code: "CHECK_IN_SETTLED"; readonly message: string; readonly actionId: string };

/** The ruling errors, spelled once. */
const CheckInRulingErrors = {
  settled: ({ actionId }: { actionId: string }): CheckInRulingError => ({
    actionId,
    code: "CHECK_IN_SETTLED",
    message: `act ${actionId} already carries the owner's word, so there is no check-in left for this reaction to settle`,
  }),
  unknown: ({ actionId }: { actionId: string }): CheckInRulingError => ({
    actionId,
    code: "CHECK_IN_UNKNOWN",
    message: `no act in the register carries the id ${actionId}`,
  }),
} as const;

/**
 * Where an act was done, read off its subject alone: a GitHub repository, else the web host, else the board or this
 * machine. Structured evidence only, so two acts are one place exactly when their subjects say so.
 *
 * @param subject the act's checkable id
 * @returns the place, in words a voice can say
 */
export function placeOfSubject({ subject }: { subject: string }): string {
  if (subject.startsWith(STATE_SUBJECT_PREFIX)) {
    return "this machine";
  }
  if (!subject.startsWith("https://") && !subject.startsWith("http://")) {
    return "the board";
  }
  let url: URL;
  try {
    url = new URL(subject);
  } catch {
    return "the board";
  }
  const [owner, repo] = url.pathname.split("/").filter((part) => part !== "");
  if (url.hostname === "github.com" && owner !== undefined && repo !== undefined) {
    return `${owner}/${repo}`;
  }
  return url.hostname;
}

/**
 * Every pattern still waiting on the owner's word, each as its members newest first — the Queue's cards.
 *
 * @param actions every folded act, newest first
 * @returns the unsettled patterns, newest card first
 */
function openPatterns({ actions }: { actions: readonly AutonomyAction[] }): readonly (readonly AutonomyAction[])[] {
  return groupPatterns({
    items: actions,
    keysOf: (entry) => autonomyPatternKeys({ action: entry.action, rule: ruleOf({ entry }) }),
  }).filter((members) => steerOf({ action: members[0]! }) === undefined);
}

/** The key a rule groups on: an act's kind in its place. */
function ruleKey({ action }: { action: AutonomyActionRow }): string {
  return JSON.stringify([action.kind, placeOfSubject({ subject: action.subject })]);
}

/**
 * The owner's check-ins as rules, the one settling the most cards first, ties to the newer lead.
 *
 * @param actions every folded act the register holds, newest first (`foldAutonomy`)
 * @returns one rule per kind and place with at least one unsettled card
 */
export function checkInRules({ actions }: { actions: readonly AutonomyAction[] }): readonly CheckInRule[] {
  const byRule = new Map<string, { lead: AutonomyActionRow; cards: number; acts: number }>();
  for (const members of openPatterns({ actions })) {
    const lead = members[0]!.action;
    const key = ruleKey({ action: lead });
    const held = byRule.get(key);
    if (held === undefined) {
      byRule.set(key, { acts: members.length, cards: 1, lead });
      continue;
    }
    held.cards += 1;
    held.acts += members.length;
  }
  return [...byRule.values()]
    .map(({ lead, cards, acts }) => ({
      acts,
      cards,
      kind: lead.kind,
      lead,
      place: placeOfSubject({ subject: lead.subject }),
    }))
    .toSorted((a, b) => b.cards - a.cards || Date.parse(b.lead.doneIso) - Date.parse(a.lead.doneIso));
}

/**
 * The acts one reaction of the owner's settles: the newest act of each card it covers, so the owner's word on it
 * settles that whole card through the pattern fold. `this` is the card holding the act the owner was read; `rule` is
 * every unsettled card of the same kind in the same place.
 *
 * @param actions every folded act the register holds, newest first
 * @param actionId the act the owner was read, its key `act:<actionId>`
 * @param covers how far the owner's reaction reaches
 * @returns the ids to record the owner's word on, the read card's first — or why there are none
 */
export function rulingTargets({
  actions,
  actionId,
  covers,
}: {
  actions: readonly AutonomyAction[];
  actionId: string;
  covers: RulingCovers;
}): Result<readonly string[], CheckInRulingError> {
  if (!actions.some((entry) => entry.action.actionId === actionId)) {
    return err(CheckInRulingErrors.unknown({ actionId }));
  }
  const patterns = openPatterns({ actions });
  const read = patterns.find((members) => members.some((entry) => entry.action.actionId === actionId));
  if (read === undefined) {
    return err(CheckInRulingErrors.settled({ actionId }));
  }
  const readLead = read[0]!.action;
  if (covers === "this") {
    return ok([readLead.actionId]);
  }
  const key = ruleKey({ action: readLead });
  const others = patterns
    .map((members) => members[0]!.action)
    .filter((lead) => lead.actionId !== readLead.actionId && ruleKey({ action: lead }) === key)
    .map((lead) => lead.actionId);
  return ok([readLead.actionId, ...others]);
}
