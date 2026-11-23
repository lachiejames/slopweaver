/**
 * `gmail triage --key <k> --pin <slug>`'s pin step: store the mail the card is about, then pin its ids — in that order,
 * so a card that stands always has the mail it asks about stored beside it (the owner opens a card to see this message
 * someone has already sent them). Split out of `./triageRun.ts`, which hands it the same injected seams.
 *
 * The pin and the stored mail are two writes, not one transaction, so the whole step runs under one per-slug lock and
 * each failure between them is settled here: a capture that fails pins nothing; a pin write that fails is settled on
 * what the pin reads back as, never on its error code — no pin discards the copy, this run's pin keeps it, another
 * run's pin stores the mail again for THAT card's ids.
 */
import type { Result } from "../../../lib/result.js";
import type { CardMailStore, CardMailStoreError } from "../../../live/gmail/cardMail.js";
import type { CardMailCaptureError } from "../../../live/gmail/cardMailCapture.js";
import { type GmailTriageCard, type TriageCardError, TriageCardErrors } from "../../../live/gmail/triageCards.js";
import { EXIT_ERROR } from "../../exitCodes.js";

/** The seams the pin step performs its effects through. */
export interface TriagePinDeps {
  readonly pin: (args: { card: GmailTriageCard; home: string }) => Result<{ readonly path: string }, TriageCardError>;
  readonly readCard: (args: { slug: string; home: string }) => Result<GmailTriageCard, TriageCardError>;
  /** Store the mail a card is about to pin, so the Queue draws it from this home rather than from Gmail. */
  readonly capture: (args: {
    card: GmailTriageCard;
    home: string;
  }) => Promise<Result<{ readonly path: string; readonly store: CardMailStore }, CardMailCaptureError>>;
  /** Remove mail captured for a pin that then could not be written. */
  readonly discardMail: (args: { slug: string; home: string }) => Result<void, CardMailStoreError>;
  /** Read the stored copy against a pin; a copy holding another card's mail is `CARD_MAIL_PIN_MISMATCH`. */
  readonly readMail: (args: { pin: GmailTriageCard; home: string }) => Result<CardMailStore, CardMailStoreError>;
  /** Take the slug's pin lock, held from the first read to the last settlement; the error is why it is busy. */
  readonly lock: (args: { slug: string; home: string }) => Result<{ readonly release: () => void }, string>;
  readonly writeDiagnostic: (line: string) => void;
}

/** Whether a standing pin is the one this run tried to write: the same key over the same ids, in order. */
function isThisPin({ standing, card }: { standing: GmailTriageCard; card: GmailTriageCard }): boolean {
  return standing.key === card.key && standing.ids.join("\n") === card.ids.join("\n");
}

/**
 * Remove the slug's stored copy only when it reads back as THIS run's mail — the same key over the same ids. A stale-lock
 * takeover can overlap two runs, so the copy on disk may already be another card's, and that one is never
 * this run's to delete. The read and the removal are still two steps; what stays open is that window alone.
 */
function discardOwnCopy({ deps, home, card }: { deps: TriagePinDeps; home: string; card: GmailTriageCard }): void {
  const onDisk = deps.readMail({ home, pin: card });
  if (onDisk.isErr()) {
    return;
  }
  const discarded = deps.discardMail({ home, slug: card.slug });
  if (discarded.isErr()) {
    deps.writeDiagnostic(discarded.error.message);
  }
}

/**
 * Another run's pin stands on this slug. Which copy is on disk depends on how the two runs interleaved, so it is read
 * against the standing pin and THAT decides: already its mail, it stays untouched; anything else, the mail is captured
 * again over the standing card's ids, and when that fails only a copy that is this run's own is removed.
 */
async function restoreStandingMail({
  card,
  deps,
  home,
  standing,
}: {
  card: GmailTriageCard;
  deps: TriagePinDeps;
  home: string;
  standing: GmailTriageCard;
}): Promise<void> {
  if (deps.readMail({ home, pin: standing }).isOk()) {
    deps.writeDiagnostic(`gmail triage: the card that pinned ${standing.slug} first keeps its stored mail`);
    return;
  }
  const restored = await deps.capture({ card: standing, home });
  if (restored.isErr()) {
    discardOwnCopy({ card, deps, home });
    deps.writeDiagnostic(
      `gmail triage: ${restored.error.message} — card ${standing.slug} stands without its mail; ` +
        `run slopweaver gmail card-mail ${standing.slug} --fetch`,
    );
    return;
  }
  deps.writeDiagnostic(`gmail triage: stored the mail for the card that pinned ${standing.slug} first`);
}

/**
 * A pin write that failed AFTER its mail was stored. The error code does not say whether a pin file was left behind —
 * a write can fail after the file is whole — so the pin is read back and THAT decides: no pin, this run's copy goes;
 * this run's own pin, the copy stays beside it; another run's pin, the mail is stored again for its ids.
 */
async function afterPinFailure({
  error,
  deps,
  card,
  home,
}: {
  error: TriageCardError;
  deps: TriagePinDeps;
  card: GmailTriageCard;
  home: string;
}): Promise<number> {
  deps.writeDiagnostic(error.message);
  const standing = deps.readCard({ home, slug: card.slug });
  if (standing.isOk() && isThisPin({ card, standing: standing.value })) {
    deps.writeDiagnostic(`gmail triage: the pin for ${card.slug} was written whole, so its stored mail stays`);
    return EXIT_ERROR;
  }
  if (standing.isOk()) {
    await restoreStandingMail({ card, deps, home, standing: standing.value });
    return EXIT_ERROR;
  }
  if (standing.error.code !== "CARD_NOT_PINNED") {
    // A pin is there but will not read: leave the copy for `card-mail`, which refuses it against that pin by name.
    deps.writeDiagnostic(standing.error.message);
    return EXIT_ERROR;
  }
  discardOwnCopy({ card, deps, home });
  return EXIT_ERROR;
}

/** The pin step itself, run only while this process holds the slug's lock. */
async function pinUnderLock({
  card,
  deps,
  heldBack,
  home,
}: {
  card: GmailTriageCard;
  deps: TriagePinDeps;
  heldBack: number;
  home: string;
}): Promise<number | undefined> {
  const existing = deps.readCard({ home, slug: card.slug });
  if (existing.isOk()) {
    deps.writeDiagnostic(TriageCardErrors.alreadyPinned({ slug: card.slug }).message);
    return EXIT_ERROR;
  }
  if (existing.error.code !== "CARD_NOT_PINNED") {
    deps.writeDiagnostic(existing.error.message);
    return EXIT_ERROR;
  }
  const captured = await deps.capture({ card, home });
  if (captured.isErr()) {
    deps.writeDiagnostic(`gmail triage: ${captured.error.message} — nothing was pinned`);
    return EXIT_ERROR;
  }
  const stored = String(captured.value.store.mails.length);
  deps.writeDiagnostic(`gmail triage: stored ${stored} message(s) for card ${card.slug} at ${captured.value.path}`);
  const pinned = deps.pin({ card, home });
  if (pinned.isErr()) {
    return afterPinFailure({ card, deps, error: pinned.error, home });
  }
  let rest = "";
  if (heldBack > 0) {
    rest = `; ${String(heldBack)} older one(s) stay in the inbox for the next reading`;
  }
  deps.writeDiagnostic(
    `gmail triage: pinned ${String(card.ids.length)} id(s) as card ${card.slug} at ${pinned.value.path}${rest}`,
  );
  return undefined;
}

/**
 * Store a card's mail, then pin it, holding the slug's lock throughout. A slug already pinned is refused BEFORE its
 * mail is captured over the stored copy, since a pin is written once. The lock is what makes the read-back after a
 * failed pin mean anything: without it a second run could pin, or capture, between that read and the discard it
 * decides, and every settlement above would be judged on a state already gone.
 *
 * @param card the pin to write, its ids already capped at what a card stores
 * @param deps the injected seams
 * @param heldBack how many of the group's older messages the cap left in the inbox, said on the pinned line
 * @param home the state home the pin and the mail are written under
 * @returns undefined when the card stands, else the exit code, with the reason already written
 */
export async function captureThenPin({
  card,
  deps,
  heldBack,
  home,
}: {
  card: GmailTriageCard;
  deps: TriagePinDeps;
  heldBack: number;
  home: string;
}): Promise<number | undefined> {
  const lock = deps.lock({ home, slug: card.slug });
  if (lock.isErr()) {
    deps.writeDiagnostic(
      `gmail triage: another run is pinning ${card.slug} (${lock.error}) — nothing was stored or pinned`,
    );
    return EXIT_ERROR;
  }
  try {
    const outcome = await pinUnderLock({ card, deps, heldBack, home });
    return outcome;
  } finally {
    lock.value.release();
  }
}
