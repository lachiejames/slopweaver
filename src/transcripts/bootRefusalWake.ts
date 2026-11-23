/**
 * The line the chair's courier types into the pinned chair when every new seat is refusing to boot, and the one
 * reader that knows it — kept in one module so the generator and the reader cannot drift apart.
 *
 * ## Why it exists
 *
 * Measured off a chair transcript and the hand register: the store fell one migration behind and every spawn refused,
 * because the plans register lives in the store. The tick had closed minutes earlier, the chair sat in a scheduled
 * sleep and ran no command, and the one detector, `claude watch`, posted its card (`mon-claude-register-…`) to the
 * OWNER's screen only. Nothing reached the chair; no spawn was even attempted. The owner's rule: the supervisor must
 * be able to say no new sessions can launch right now, launch an investigator through the escape hatch, and fix it —
 * the manager whose staff are locked out unlocks the door, and lacking the ability or the freedom to is a
 * misalignment. The refusal itself stays: a migration is never forced blind, judgement applies it.
 *
 * So the courier — the one process inside the visible chair that may type into it (`../talk/supervisorDelivery.ts`),
 * never a daemon (rule 2), and never the one that starts a model — types this line ONCE per open register card
 * (`../talk/bootRefusalWakeShell.ts`). It lives here, beside `./fleetNudge.ts`, because the transcript reader is the
 * other half of it and must not reach into `talk/`. The register
 * card is the signal because it is exactly "every new Claude session refuses to start"
 * (`../monitor/claudePlanUnusableDefinition.ts`), and it lives in a FILE (`../hand/store.ts`), readable while the store
 * is the thing that is down.
 *
 * ## Which line, decided from a fresh register read, never from the card's prose
 *
 * The card says only that the register does not read. Whether the `stale-store` hatch helps is decided by reading the
 * register again: still refused as a STALE store, and the line hands the chair the two exact commands that seat one
 * Opus investigator under the hatch — `--driver claude` because an omitted driver rereads the register to pick a host
 * (`../cli/commands/cmux/spawnDriver.ts`), and never `--plan`, which does the same (`claudePlanFlag.ts`). Refused any
 * other way, and no hatch boots a seat, so the line says so and names none. Reading fine, and the card is residue: no
 * line at all.
 *
 * ## It is machine traffic, never the owner's words
 *
 * A typed line reads `promptSource: "typed"`, the same as the owner's own (`./fleetNudge.ts`), so the reader
 * re-renders both lines for the card id it parses and compares the WHOLE text. The residue is the fleet nudge's: a
 * person who types a generated line verbatim reads as the wake.
 *
 * Pure.
 */

/** A register card id: the prefix, a 16-hex digest, and an optional `.N` occurrence suffix (`../monitor/registry.ts`). */
const REGISTER_CARD_ID = /^mon-claude-register-([0-9a-f]{16})(?:\.([0-9]+))?$/u;

/** How the head of the line opens, before the card id. */
const HEAD_OPEN = "[boots refused ";

/** The longest line the courier types — the inline paste cap a relay keeps (`../cmux/relayFile.ts`). */
export const BOOT_REFUSAL_LINE_MAX = 800;

/** What a fresh register read said about why every boot refuses. */
export type BootRefusalCause = "stale-store" | "register-unreadable";

/**
 * The board row an investigator is seated on for one card: the digest, plus the occurrence when the card has one.
 *
 * @param cardId a register card id
 * @returns the slug, or undefined for an id that is not a register card's
 */
export function bootRefusalSlug({ cardId }: { cardId: string }): string | undefined {
  const match = REGISTER_CARD_ID.exec(cardId);
  if (match === null) {
    return undefined;
  }
  const [, digest, occurrence] = match;
  return occurrence === undefined ? `boots-refused-${digest!}` : `boots-refused-${digest!}-${occurrence}`;
}

/**
 * Whether a hand step id is the `claude-plan-unusable` REGISTER card.
 *
 * @returns true for the register card's exact id shape
 */
export function isRegisterCardId({ id }: { id: string }): boolean {
  return REGISTER_CARD_ID.test(id);
}

/**
 * The one line typed into the chair for one register card.
 *
 * @param cardId the open register card's id
 * @param cause what the fresh register read found
 * @returns the line, or undefined for an id that is not a register card's
 */
export function bootRefusalWakeLine({
  cardId,
  cause,
}: {
  cardId: string;
  cause: BootRefusalCause;
}): string | undefined {
  const slug = bootRefusalSlug({ cardId });
  if (slug === undefined) {
    return undefined;
  }
  const head = `${HEAD_OPEN}${cardId}] Every new Claude seat is refusing to boot: `;
  const close =
    "Keep the refusal: judge the migration, never a blind `store push` (skills/supervisor/reference/boots-refused.md).";
  if (cause === "register-unreadable") {
    return (
      `${head}the plans register does not read and the store is not merely stale, so no hatch boots a seat. ` +
      "Say in one line that no new sessions can launch right now, read `slopweaver store status`, and make the store " +
      `readable from this chair. ${close}`
    );
  }
  const hatch = "SLOPWEAVER_ALLOW_STALE_STORE=1";
  return (
    `${head}the store answered and was refused as stale. Say in one line that no new sessions can launch right now, ` +
    "then seat ONE Opus investigator, each command on its own: " +
    `\`${hatch} slopweaver handover register --ask "Investigate why every boot refuses (${cardId})" --dispatch ` +
    `--slug ${slug} --priority p0\`, then \`${hatch} slopweaver cmux spawn ${slug} --driver claude --model opus\`. ${close}`
  );
}

/**
 * Whether a turn's text is exactly a line the courier typed, rather than a person's words.
 *
 * @returns true only for a whole generated line, either cause, carrying a register card id
 */
export function isBootRefusalWake({ text }: { text: string }): boolean {
  if (!text.startsWith(HEAD_OPEN)) {
    return false;
  }
  const end = text.indexOf("]", HEAD_OPEN.length);
  if (end < 0) {
    return false;
  }
  const cardId = text.slice(HEAD_OPEN.length, end);
  const causes: readonly BootRefusalCause[] = ["stale-store", "register-unreadable"];
  return causes.some((cause) => bootRefusalWakeLine({ cardId, cause }) === text);
}

/**
 * The oldest open register card the chair has not been woken for, or undefined when there is none.
 *
 * One card is one fault episode, so a fault that clears and comes back is a new card and a new wake, while the same
 * card standing for an hour wakes the chair once.
 *
 * @param openCardIds the id of every hand step still open, oldest first
 * @param claimed whether a card was already claimed by a wake
 * @returns the card to wake for
 */
export function nextUnwokenCard({
  openCardIds,
  claimed,
}: {
  openCardIds: readonly string[];
  claimed: (cardId: string) => boolean;
}): string | undefined {
  return openCardIds.find((id) => isRegisterCardId({ id }) && !claimed(id));
}
