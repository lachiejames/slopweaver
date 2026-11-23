/**
 * Every way saying what happens to a relay's hand card, at `handover settle`, fails — one union, one factory.
 *
 * Failures of FACT and of usage, not policy refusals: a missing disposition is refused the way a missing
 * `--witness` is, because the settle cannot be written truthfully without it
 * (`.claude/rules/error-handling.md` § "A POLICY refusal is not a domain error").
 */
import { resolve } from "node:path";

import { shellCommandLine } from "#lib/shellCommandLine.js";

/** `--card` carried something other than done, recut or kept. */
export interface CardFlagInvalidError {
  readonly code: "CARD_FLAG_INVALID";
  readonly message: string;
  readonly value: string;
}

/** A companion flag was passed beside a disposition that does not take it, or with no `--card` at all. */
export interface CardCompanionMisplacedError {
  readonly code: "CARD_COMPANION_MISPLACED";
  readonly message: string;
  readonly flag: string;
}

/** A disposition was passed without the companion it needs. */
export interface CardCompanionMissingError {
  readonly code: "CARD_COMPANION_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** The relay's card is still open and the settle did not say what happens to it. */
export interface CardDispositionMissingError {
  readonly code: "CARD_DISPOSITION_MISSING";
  readonly message: string;
  readonly cardKey: string;
}

/** The relay's card was re-cut, so only `--card recut --card-new <successor>` describes it. */
export interface CardRecutRequiredError {
  readonly code: "CARD_RECUT_REQUIRED";
  readonly message: string;
  readonly cardKey: string;
  readonly successors: readonly string[];
}

/** `--card recut` named a card no re-cut of this one posted. */
export interface CardRecutUnverifiedError {
  readonly code: "CARD_RECUT_UNVERIFIED";
  readonly message: string;
  readonly cardKey: string;
  readonly named: string;
}

/** `--card` was passed on a row with no open or re-cut hand card to answer for. */
export interface CardDispositionInapplicableError {
  readonly code: "CARD_DISPOSITION_INAPPLICABLE";
  readonly message: string;
}

/** The row's `talk:` anchor names a turn that cannot be read. */
export interface RelayTurnUnreadableError {
  readonly code: "RELAY_TURN_UNREADABLE";
  readonly message: string;
  readonly anchor: string;
}

/** The turn the row's anchor names contradicts the row. */
export interface RelayRowMismatchError {
  readonly code: "RELAY_ROW_MISMATCH";
  readonly message: string;
  readonly anchor: string;
  readonly field: string;
}

/** No turn names the row's card, and an open hand card names the row itself, so settling it would strand that card. */
export interface RowCardOpenError {
  readonly code: "ROW_CARD_OPEN";
  readonly message: string;
  readonly slug: string;
  readonly cardKeys: readonly string[];
}

/** The hand register skipped a line, so the card's fate cannot be proven. */
export interface HandRegisterIncompleteError {
  readonly code: "HAND_REGISTER_INCOMPLETE";
  readonly message: string;
  readonly lineNumbers: readonly number[];
}

/** Something else closed the card between the plan and the lock the effect is taken under. */
export interface CardSettledOtherwiseError {
  readonly code: "CARD_SETTLED_OTHERWISE";
  readonly message: string;
  readonly cardKey: string;
}

/** A register the card effect reads or writes failed. */
export interface CardRegisterFailedError {
  readonly code: "CARD_REGISTER_FAILED";
  readonly message: string;
}

/** Every way this domain fails. */
export type SettleCardError =
  | CardFlagInvalidError
  | CardCompanionMisplacedError
  | CardCompanionMissingError
  | CardDispositionMissingError
  | CardRecutRequiredError
  | CardRecutUnverifiedError
  | CardDispositionInapplicableError
  | RelayTurnUnreadableError
  | RelayRowMismatchError
  | RowCardOpenError
  | HandRegisterIncompleteError
  | CardSettledOtherwiseError
  | CardRegisterFailedError;

/** The three dispositions, spelled once for every refusal that lists them. */
const CHOICES =
  '--card done (it is finished), --card kept --card-why "<why it stays up>" (answering was not finishing), or ' +
  "--card recut --card-new <new id> (after `slopweaver hand post … --supersedes <this id>`)";

/** Constructors for {@link SettleCardError}. The only place one is built. */
export const SettleCardErrors = {
  cardFlagInvalid: ({ value }: { value: string }): CardFlagInvalidError => ({
    code: "CARD_FLAG_INVALID",
    message: `--card must be done, recut or kept, not "${value}"`,
    value,
  }),
  companionMisplaced: ({ flag, disposition }: { flag: string; disposition: string }): CardCompanionMisplacedError => ({
    code: "CARD_COMPANION_MISPLACED",
    flag,
    message:
      disposition === ""
        ? `${flag} says something about a card, so it needs --card beside it`
        : `${flag} does not go with --card ${disposition}: --card-why is for kept, --card-new for recut`,
  }),
  companionMissing: ({ flag, disposition }: { flag: string; disposition: string }): CardCompanionMissingError => ({
    code: "CARD_COMPANION_MISSING",
    flag,
    message:
      disposition === "kept"
        ? "--card kept needs --card-why: a card left up says why, where the next reader of the owner's queue sees it"
        : "--card recut needs --card-new: the id of the card the re-cut posted",
  }),
  dispositionMissing: ({ cardKey }: { cardKey: string }): CardDispositionMissingError => ({
    cardKey,
    code: "CARD_DISPOSITION_MISSING",
    message:
      `this row is the relay the owner spoke with ${cardKey} open, and that card is still on their queue — say what ` +
      `happens to it: ${CHOICES}`,
  }),
  recutRequired: ({
    cardKey,
    successors,
  }: {
    cardKey: string;
    successors: readonly string[];
  }): CardRecutRequiredError => ({
    cardKey,
    code: "CARD_RECUT_REQUIRED",
    message: `${cardKey} was re-cut as ${successors.join(", ")} — pass --card recut --card-new ${successors.join("|")}`,
    successors,
  }),
  recutUnverified: ({
    cardKey,
    named,
    successors,
  }: {
    cardKey: string;
    named: string;
    successors: readonly string[];
  }): CardRecutUnverifiedError => ({
    cardKey,
    code: "CARD_RECUT_UNVERIFIED",
    message:
      successors.length === 0
        ? `${cardKey} is still open, so nothing re-cut it: re-cut it with \`slopweaver hand post … --supersedes\` first, or choose ${CHOICES}`
        : `no re-cut of ${cardKey} posted ${named} — it was re-cut as ${successors.join(", ")}`,
    named,
  }),
  dispositionInapplicable: ({ why }: { why: string }): CardDispositionInapplicableError => ({
    code: "CARD_DISPOSITION_INAPPLICABLE",
    message: `--card has nothing to answer for here: ${why}. Settle without it`,
  }),
  relayTurnUnreadable: ({ anchor, why }: { anchor: string; why: string }): RelayTurnUnreadableError => ({
    anchor,
    code: "RELAY_TURN_UNREADABLE",
    message: `the row's anchor ${anchor} is a talk relay whose turn cannot be read (${why}), so which card it was said over is unknown`,
  }),
  relayRowMismatch: ({ anchor, field }: { anchor: string; field: string }): RelayRowMismatchError => ({
    anchor,
    code: "RELAY_ROW_MISMATCH",
    field,
    message: `the turn behind ${anchor} does not match this row: its ${field} disagrees, so its card is not this row's to answer for`,
  }),
  /**
   * Each recovery names the settle's own `home`, so it closes the card in the register that refused, never the default.
   * The home is RESOLVED to an absolute path, because a relative or empty one names another register once the
   * recovery runs from another directory, and it is joined as ONE `--home=<home>` token, because a home spelled
   * `-h` printed as its own word is read as help.
   */
  rowCardOpen: ({ slug, ids, home }: { slug: string; ids: readonly string[]; home: string }): RowCardOpenError => ({
    cardKeys: ids.map((id) => `hand:${id}`),
    code: "ROW_CARD_OPEN",
    message:
      `no relay turn names a hand card for this row, and an open hand card names row ${slug} ` +
      `(${ids.map((id) => `hand:${id}`).join(", ")}) — once each step is done, close it first (` +
      ids
        .map(
          (id) =>
            `\`${shellCommandLine({ command: ["slopweaver", "hand", "done", id, "--did", "<what was done>", `--home=${resolve(home)}`] })}\``,
        )
        .join(", then ") +
      "), then settle again",
    slug,
  }),
  handRegisterIncomplete: ({ lineNumbers }: { lineNumbers: readonly number[] }): HandRegisterIncompleteError => ({
    code: "HAND_REGISTER_INCOMPLETE",
    lineNumbers,
    message:
      `the hand register has unreadable line(s) ${lineNumbers.join(", ")}, so the card's fate cannot be proven — ` +
      "repair them (`slopweaver hand list` names them) and settle again",
  }),
  settledOtherwise: ({ cardKey }: { cardKey: string }): CardSettledOtherwiseError => ({
    cardKey,
    code: "CARD_SETTLED_OTHERWISE",
    message: `${cardKey} was closed by something else while this settle ran — read \`slopweaver hand show\` and settle again`,
  }),
  registerFailed: ({ why }: { why: string }): CardRegisterFailedError => ({
    code: "CARD_REGISTER_FAILED",
    message: why,
  }),
} as const;
