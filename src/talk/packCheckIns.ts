/**
 * The owner's check-ins as the console voice reads them: one entry per rule, the rule clearing the most cards first,
 * gathered and rendered for the context pack and for `talk check-ins` alike, so what the voice reads past the pack
 * is the same shape it started with.
 *
 * ## The shape is the owner's
 *
 * The walk is the owner's ruling: the voice picks the next one,
 * reads it out, the owner reacts, and it goes on to the next without the owner pushing. The entry shape is the owner's
 * ruling too, on a CodeRabbit pushback: pushing back is what the fleet always does
 * there, so the question is not "was it right to push back" but "was the reason valid in this specific example",
 * with the reason and its evidence in front of the owner. So each entry carries what was done, the reason the fleet
 * gave and the evidence, and the voice's prompt asks that one question of it.
 *
 * Pure: the register and the board are read by the caller.
 */
import { checkInRules } from "../autonomy/checkIns.js";
import type { AutonomyAction } from "../autonomy/types.js";
import { CHECK_IN_KEY_PREFIX } from "./checkInRuling.js";
import { clip, fitSection } from "./packText.js";

/**
 * One check-in RULE: every card the fleet did of one kind in one place, read to the owner as its newest act — what was
 * done, the reason the fleet gave and its evidence, then the one question.
 */
export interface PackCheckIn {
  /** The newest act's queue key, `act:<actionId>` — what `relay_steer`'s `check_in` names. */
  readonly key: string;
  readonly kind: string;
  /** A GitHub `owner/repo`, a web host, `the board` or `this machine` (`../autonomy/checkIns.ts`). */
  readonly place: string;
  /** The Queue cards a ruling on this check-in would clear, this one included. */
  readonly cards: number;
  readonly acts: number;
  readonly doneIso: string;
  /** The act's plain-words line, when it carries one. */
  readonly did: string | undefined;
  /** The reason the fleet gave, the act's `why`. */
  readonly reason: string;
  /** What shows it happened, the act's `witness`. */
  readonly evidence: string;
  /** The board row it was done under, when it names one. */
  readonly origin: string | undefined;
  /**
   * That row's tags as `key:value`, or `undefined` when they were not read: the row is off the board, the board
   * could not be composed, or the page came from `talk check-ins`, which does not compose it.
   */
  readonly tags: readonly string[] | undefined;
}

/**
 * The byte budget of the pack's check-ins section, and of each page `talk check-ins` prints past it — one size, so
 * a page read mid-call is the same shape as the one the call started with.
 */
export const CHECK_IN_PAGE_BYTES = 12 * 1024;

/** Where a check-in's reason and its plain-words line are cut, in characters. */
const CHECK_IN_REASON_CHARS = 400;

/** Where a check-in's evidence is cut, in characters. */
const CHECK_IN_EVIDENCE_CHARS = 200;

/**
 * The owner's check-ins as rules, each read as its newest act.
 *
 * @param actions every folded act the register holds, newest first
 * @param tagsOf the tags of the board row an act was done under, `undefined` when they were not read
 * @returns one entry per rule, the one clearing the most cards first
 */
export function packCheckInsOf({
  actions,
  tagsOf,
}: {
  actions: readonly AutonomyAction[];
  tagsOf: (row: { slug: string }) => readonly string[] | undefined;
}): readonly PackCheckIn[] {
  return checkInRules({ actions }).map((rule) => ({
    acts: rule.acts,
    cards: rule.cards,
    did: rule.lead.said,
    doneIso: rule.lead.doneIso,
    evidence: rule.lead.witness,
    key: `${CHECK_IN_KEY_PREFIX}${rule.lead.actionId}`,
    kind: rule.kind,
    origin: rule.lead.run,
    place: rule.place,
    reason: rule.lead.why,
    tags: rule.lead.run === undefined ? undefined : tagsOf({ slug: rule.lead.run }),
  }));
}

/**
 * One check-in with every passage already cut where the render would cut it, for `talk pack --write` to store.
 *
 * @param checkIn the entry as gathered
 * @returns the same entry, each passage cut
 */
export function checkInForStorage({ checkIn }: { checkIn: PackCheckIn }): PackCheckIn {
  return {
    ...checkIn,
    did: checkIn.did === undefined ? undefined : clip({ max: CHECK_IN_REASON_CHARS, text: checkIn.did }),
    evidence: clip({ max: CHECK_IN_EVIDENCE_CHARS, text: checkIn.evidence }),
    reason: clip({ max: CHECK_IN_REASON_CHARS, text: checkIn.reason }),
  };
}

/**
 * One check-in as the lines the voice reads: what was done, the reason the fleet gave, the evidence, where it came
 * from — the owner's shape.
 *
 * @param checkIn the entry
 * @returns its lines, joined
 */
function checkInEntry({ checkIn }: { checkIn: PackCheckIn }): string {
  const others = checkIn.cards - 1;
  const reach = others === 0 ? "the only card of its rule" : `${String(others)} more card(s) share its rule`;
  const lines = [
    `- ${checkIn.key} — ${checkIn.kind} in ${checkIn.place}, done ${checkIn.doneIso}; ${reach} (${String(checkIn.acts)} act(s) in all)`,
  ];
  if (checkIn.did !== undefined) {
    lines.push(`  what the fleet did: ${clip({ max: CHECK_IN_REASON_CHARS, text: checkIn.did })}`);
  }
  lines.push(`  the reason it gave: ${clip({ max: CHECK_IN_REASON_CHARS, text: checkIn.reason })}`);
  lines.push(`  evidence: ${clip({ max: CHECK_IN_EVIDENCE_CHARS, text: checkIn.evidence })}`);
  if (checkIn.origin === undefined) {
    lines.push("  origin: no board row named");
    return lines.join("\n");
  }
  let tags = "its tags not read — board_row has them";
  if (checkIn.tags?.length === 0) {
    tags = "no tags";
  } else if (checkIn.tags !== undefined) {
    tags = `tags ${checkIn.tags.join(", ")}`;
  }
  lines.push(`  origin: row ${checkIn.origin} (${tags})`);
  return lines.join("\n");
}

/**
 * The check-ins as a heading and the entries that fit, starting `skip` rules in — the pack's section, and each
 * page `talk check-ins` prints.
 *
 * @param checkIns every rule, the one clearing the most cards first
 * @param skip how many rules to pass over, those already read
 * @param budget the UTF-8 byte budget of the entries
 * @returns the heading, the entries that fit, and a line naming how many did not
 */
export function checkInLines({
  checkIns,
  skip,
  budget,
}: {
  checkIns: readonly PackCheckIn[];
  skip: number;
  budget: number;
}): readonly string[] {
  const cards = checkIns.reduce((sum, entry) => sum + entry.cards, 0);
  const shown = checkIns.slice(skip);
  const from = skip === 0 ? "" : `, from rule ${String(skip + 1)}`;
  const heading =
    `## Check-ins — done already, the owner's word is a review: ${String(checkIns.length)} rule(s) covering ` +
    `${String(cards)} card(s), the rule clearing the most first${from}`;
  if (shown.length === 0) {
    return [heading, "(none left from here)"];
  }
  return [heading, ...fitSection({ budget, entries: shown.map((checkIn) => checkInEntry({ checkIn })) })];
}
