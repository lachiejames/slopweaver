/**
 * Whether a Queue card is ready for the owner to react to, in words they can read — the console half of
 * `handover currency`.
 *
 * The mark is plain: a "last confirmed by the hands register still holds; may need review after 6h" line means
 * nothing to the owner, who wants zero chance of opening a card already answered or implicitly steered. The check is
 * BATCHED, so the card says when it was checked, against what, and whether anything from the owner since could have
 * changed it. A check that could not run reads could-not-check, never still-a-problem.
 *
 * - The collapsed card says when it was LAST CHECKED, never when it first reached the owner's screen, and "things you
 *   have said since" belongs on the opened card. Measured: a card read "2.8d ago" beside "live from its register", a hand
 *   step opening an ask already ruled on. A card whose ask carries the owner's ruling reads "you ruled on it" and
 *   leaves the waiting tiers.
 * - An unchecked card STAYS, but reads apart from a fresh one at a glance, so the owner starts with the fresh ones.
 * - Fresh means BOTH halves were rechecked — its facts and the owner's steers. A card whose facts were rechecked and
 *   the owner's steers not is not ready, and the mark says which half was checked rather than claiming fresh.
 *
 * So the mark is two halves. FACTS: when its own register last read it, an ask's still-real check, an ask's
 * done-check read. STEERS: the tick's reading of everything the owner said since it was asked AND every change to
 * their standing rulings, memories and owner profile since (schema 3), which passes only when none of it could bear on the
 * card. A reading older than schema 3 never read the standing set, so its steers never pass. A card no tick reading
 * covers has its steers unchecked, whatever its register says.
 *
 * It imports NOTHING, for the reason `./queueCard.ts` states in full; the clock reaches it through `ageOf`.
 */

/**
 * What a card that is not fresh means, in the hover: it stays so the owner can see what was there, and it
 * may be superseded, stale or closed with nothing needed from them.
 */
export const MAY_BE_STALE =
  "Not ready to react to yet: it may be superseded, stale or closed with nothing needed from you.";

/**
 * The currency reading as a page or the voice names it when it has not arrived: the Queue's ranking, and which cards
 * have left the waiting tiers, both rest on it, so a page drawn without it says so rather than ranking in silence.
 */
export const CURRENCY_CHECK = "the check of what you said since each card reached you";

/**
 * The done-check of an ask that declares none — `src/handover/currency.ts`'s `OWNER_RULING_DONE_KIND`, restated because
 * this file imports nothing and held equal by `site/__tests__/unit/ownerVocabularyMirror.test.ts`.
 */
export const OWNER_RULING_DONE_KIND = "on-owner-ruling" as const;

/** What the reading says about one ask's done-check. */
export type CurrencyDone =
  | { readonly kind: "replied"; readonly atIso: string; readonly permalink: string }
  | { readonly kind: "not-yet"; readonly readAtIso: string }
  | { readonly kind: "could-not-check"; readonly why: string }
  | { readonly kind: "declared-not-run"; readonly checks: readonly string[] }
  | { readonly kind: typeof OWNER_RULING_DONE_KIND };

/** One thing the owner said after a card's floor that could bear on it. */
export interface CurrencyWord {
  readonly atIso: string;
  readonly pointer: string;
  readonly source: "chair" | "voice" | "relay";
  readonly filed: "here" | "unfiled";
}

/**
 * One change to the owner's standing guidance after a card's floor — `StandingChange` (`src/handover/currencyStanding.ts`),
 * restated: a memory, the owner profile or a ruling, written or recorded after the card reached the owner. A ruling on the
 * card's own row is `here`; every other change can bear on any card.
 */
export interface CurrencyStandingChange {
  readonly atIso: string;
  readonly pointer: string;
  readonly source: "memory" | "profile" | "ruling";
  readonly filed: "here" | "unfiled";
}

/**
 * Every reason a producer gives for a card's facts not being confirmed — `NOT_CONFIRMED_WHYS` (`src/handover/currency.ts`),
 * restated because the console cannot import it, and held equal to it by `src/__tests__/unit/notConfirmedWhysMirror.test.ts`.
 * Only one of these reaches a card's open lines or hover; anything else a reading carries goes to its staleness mark.
 */
export const NOT_CONFIRMED_WHYS = [
  "no pass of its monitor is recorded",
  "its monitor's last recorded pass is not a monitor check document",
  "its monitor's last recorded pass holds no reading of that monitor",
  "its monitor's last recorded pass declares a state this check does not know",
  "its monitor's last recorded pass carries a subject this check cannot read",
  "its monitor's last pass would not read",
  "its monitor's last pass found the condition clear",
  "its monitor's last pass no longer names it",
  "its monitor's last pass found a steer of yours already answers it",
  "its monitor's last pass could not measure it",
  "no monitor this build defines posts it, so no pass can re-confirm it",
  "its Slack thread could not be read",
  "nothing has re-confirmed it since it was asked",
  "two sources mint this card's key and floor and disagree on its reading, so neither is confirmed",
] as const;

/**
 * Whether a reading's reason is one a producer of this build writes, and so may be printed on the card itself.
 *
 * @param why the reading's `fact.why`
 * @returns true for one of {@link NOT_CONFIRMED_WHYS}
 */
export function isNotConfirmedWhy({ why }: { why: string }): boolean {
  return NOT_CONFIRMED_WHYS.some((known) => known === why);
}

/**
 * Whether a card's facts were re-confirmed, and by what, in a schema-2 reading: a monitor-raised hand step by that
 * monitor's own last firing pass, never by the hands register merely still holding it (`src/handover/currencyCards.ts`).
 * A not-confirmed fact's `why` stays a string here so an older reading's free text still decodes, to be kept off the
 * card; `unread` is a failed read's own reason, which only the staleness mark shows.
 */
export type CurrencyFact =
  | { readonly kind: "confirmed"; readonly atIso: string; readonly by: string }
  | { readonly kind: "not-confirmed"; readonly why: string; readonly unread?: string };

/**
 * One card's row in the reading. A schema-2 row carries its {@link CurrencyFact} and, for an ask only, its done-check; a
 * legacy row (no `schemaVersion` on the document) is an ask's, always carrying `done` and never `fact`.
 */
export interface CurrencyCardRow {
  readonly key: string;
  /** On an ask's row, when the owner was asked; absent on every other kind. */
  readonly askedIso?: string;
  /** The card's version: a card whose own floor differs is a newer card than the one this row read. */
  readonly floorIso: string | undefined;
  readonly done?: CurrencyDone;
  readonly fact?: CurrencyFact;
  /**
   * On an ask's row (schema 3), the ruling the owner gave on this same question before it was asked again word for
   * word — `talk restore` re-asking a landed ask. It predates the floor, so it is never one of `since`'s words; the mark
   * reads it as the owner's reaction to this card (`./cardCurrencyMark.ts`).
   */
  readonly sameQuestionRuling?: { readonly atIso: string; readonly pointer: string };
  readonly since: {
    readonly words: readonly CurrencyWord[];
    /**
     * The changes to the owner's standing rulings, memories and owner profile since its floor. Absent on a reading older than
     * schema 3, which never read them — so its steers half never passes (`./cardCurrencyHalves.ts`).
     */
    readonly standing?: readonly CurrencyStandingChange[];
    readonly gaps: readonly string[];
  };
}

/** Where a quote of the owner is known cut — the reading's own `HisWordsCut` (`src/handover/hisWords.ts`). */
export type SaidCut = "none" | "start" | "end";

/** The owner's words behind one pointer, as far as the reading carries them, and where the record lost the rest. */
export interface CurrencySaid {
  readonly text: string;
  readonly cut: SaidCut;
}

/** A kind of proof the owner asked for on a pull request — `ProofKind` (`src/handover/proofAsk.ts`), restated. */
export type CurrencyProofKind = "image" | "run-link" | "datadog";

/** What the live body says about the owner's proof ask — `PrProof` (`src/handover/prProof.ts`), the halves a card reads. */
export type CurrencyPrVerdict =
  | { readonly kind: "requested-and-met" }
  | { readonly kind: "requested-and-unmet"; readonly missing: readonly CurrencyProofKind[]; readonly gap: string }
  | { readonly kind: "body-unread"; readonly why: string };

/** One pull request the owner asked for proof on, its verdict, and every board row naming it. */
export interface CurrencyPullRequest {
  /** `owner/repo#number`, lowercased. */
  readonly identity: string;
  readonly rowSlugs: readonly string[];
  readonly proof: CurrencyPrVerdict;
}

/** The reading the tick records — `reading last --producer "handover currency"`. */
export interface CurrencyReading {
  /**
   * `3` on a reading that also read the owner's standing guidance; `2` on one carrying a row per Queue card kind; absent on an
   * older, ask-only one.
   */
  readonly schemaVersion?: 2 | 3;
  readonly checkedIso: string;
  readonly readFromIso: string;
  readonly sources: {
    readonly chair: string;
    readonly relays: string;
    readonly voice: string;
    /** What the standing read found in each source; present exactly on a schema-3 reading. */
    readonly standing?: { readonly memory: string; readonly profile: string; readonly rulings: string };
  };
  readonly rows: readonly CurrencyCardRow[];
  /** The owner's words by pointer, once each. Absent on a reading recorded before the tick carried them. */
  readonly said?: Readonly<Record<string, CurrencySaid>>;
  /** Every pull request the owner asked for proof on. Absent on a reading recorded before the tick read their bodies. */
  readonly pullRequests?: readonly CurrencyPullRequest[];
}

/**
 * One thing the owner said since, as a sentence: where and how long ago, then their own words. A row never reads as a
 * raw ISO instant, a bare word ("chair") that means furniture to a reader, or a bare pointer: all three read as
 * "nothing readable".
 */
export interface SaidRow {
  /** Where the owner said it and how long ago — "In the supervisor chat, 3.2h ago". */
  readonly where: string;
  /** The instant, for the row's hover only — never drawn in the text. */
  readonly atIso: string;
  /** The opening of the owner's words, whole when short, for the row's own line; absent when the reading carries none. */
  readonly lead: string | undefined;
  /** Whether more of the owner's words sit behind {@link lead} — the row then opens onto the whole of them. */
  readonly more: boolean;
  /** The owner's words as the reading carries them — what opening the row shows. */
  readonly said: CurrencySaid | undefined;
}

/** One group of the fold: the rows tied to this card, or the ones no session has tied to any card yet. */
export interface SaidGroup {
  readonly heading: string;
  readonly rows: readonly SaidRow[];
}

/**
 * Everything the owner said since, which the opened card draws ONLY folded, behind {@link SaidFold.summary}. There is no field
 * on {@link CardCurrency} that puts one of these rows above the fold: rule 7 (`AGENTS.md`) enforced by this shape, never
 * by review — a card once ran twenty screens because each word was a line of the always-open section.
 */
export interface SaidFold {
  /** The count the owner expands — "148 things you said since it was asked, none yet tied to a card". */
  readonly summary: string;
  readonly groups: readonly SaidGroup[];
}

/**
 * What the opened card's Checked fold shows first, at most four lines by TYPE — its facts, the owner's steers, what done means,
 * and the may-be-stale line; a ruled or answered card fewer. However many words the owner said since, this cannot grow.
 */
export type CheckedLines = readonly [string, string?, string?, string?];

/**
 * A read inside the check that failed — the shape of `StalenessFact` (`./stalenessLabel.ts`), restated since this file
 * imports nothing — drawn as one staleness mark beside the check, never a sentence in its lines.
 */
export interface CurrencyUnread {
  readonly subject: string;
  readonly why: string;
}

/** What the card's mark says. */
export interface CardCurrency {
  /**
   * `fresh` when both halves passed; `facts-only` or `steers-only` naming the one half that did; `unchecked` when
   * neither did; `looks-answered`, `ruled` and `reacted` when the card is no longer the owner's to react to at all.
   */
  readonly kind: "fresh" | "facts-only" | "steers-only" | "unchecked" | "looks-answered" | "ruled" | "reacted";
  /** Whether both halves were rechecked and passed — the one state the owner can react to without wondering. */
  readonly fresh: boolean;
  /**
   * The badge's own words — short: which half was checked and when, or, when neither passed, what each half needs
   * ("not re-confirmed · you said things since"), never an age a seconds-old check would read as late by.
   */
  readonly words: string;
  /** The opened card's Checked section, first inside its one closed fold. */
  readonly lines: CheckedLines;
  /** The collapsed badge's hover: the same lines, and only those. */
  readonly title: string;
  /** What the owner said since, drawn only behind a closed fold; `undefined` when there is nothing to list. */
  readonly said: SaidFold | undefined;
  /** Reads inside the check that failed, every instant in their reasons aged, for one staleness mark; empty when none. */
  readonly unread: readonly CurrencyUnread[];
}

/** The part of a Queue row this reads. */
export interface CurrencyCard {
  readonly key: string;
  readonly kind: string;
  readonly aliases?: readonly string[];
  /** For an ask, when the owner was asked — the binding a reading must match. */
  readonly whenIso: string | undefined;
  /** When the card's facts were last confirmed: its register's read, or an ask's still-real check. */
  readonly verifiedIso: string | undefined;
  /** When the owner ruled on the ask this card opens, while that ask's row reads `already-ruled`; absent otherwise. */
  readonly ruledIso?: string;
  /**
   * The card's version, the instant the producer stamps as its row's `floorIso` (`src/handover/currencyCards.ts`): a
   * schema-2 row with a different floor read an older or newer card than this one. Absent when nothing dates it.
   */
  readonly currencyFloorIso?: string | undefined;
}
