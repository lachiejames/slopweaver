/**
 * The ids a triage card showed the owner, pinned when the card is made, so their answer acts on exactly that set.
 *
 * A card names a sender group, but the group moves: mail arrives after the card is made, and snoozed mail comes back
 * into the inbox with its ORIGINAL received time. Acting on a fresh reading of the group — even one bounded by time —
 * would archive mail the owner never saw on the card. So `gmail triage --key <k> --pin <card-slug>` writes the group's ids as
 * they stand into `live/gmail/triage-cards/<card-slug>.json`, ONCE, and `gmail triage --card <card-slug>` later prints
 * the pinned ids a fresh reading still finds in the inbox (`pinnedStillInInbox`, `./triageActs.ts`). Nothing else.
 *
 * Write-once, because a re-pin under a slug the owner has already been shown would silently widen what their answer covers.
 * Ids only, never a subject: a message id names a message without saying anything about it. The directory is still
 * forced to `0700` and the file made `0600`, because a set of ids is the owner's mailbox's shape.
 */
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { IngestError } from "../../lib/ingestError.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { createFileExclusive, ensureDirectory } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";

/** One card's pinned set. */
export interface GmailTriageCard {
  readonly schemaVersion: 1;
  readonly slug: string;
  /** The group key the ids were read from, for a reader checking the card and the pin agree. */
  readonly key: string;
  /** The reading's own instant — when the set was true. */
  readonly pinnedAtIso: string;
  readonly ids: readonly string[];
}

const CARD_SCHEMA = z.object({
  ids: z.array(z.string().min(1)).min(1),
  key: z.string().min(1),
  pinnedAtIso: z.string().min(1),
  schemaVersion: z.literal(1),
  slug: z.string().min(1),
});

/** No card is pinned under that slug — the card was made without a pin, or the slug is wrong. */
interface TriageCardNotPinnedError {
  readonly code: "CARD_NOT_PINNED";
  readonly message: string;
  readonly slug: string;
}

/** A pin already stands under that slug, and a pin is written once. */
interface TriageCardAlreadyPinnedError {
  readonly code: "CARD_ALREADY_PINNED";
  readonly message: string;
  readonly slug: string;
}

/** The pin file is there and is not a pin. */
interface TriageCardMalformedError {
  readonly code: "CARD_MALFORMED";
  readonly message: string;
  readonly slug: string;
}

/** The filesystem refused the read or the write. */
interface TriageCardIoError {
  readonly code: "CARD_IO";
  readonly message: string;
  readonly cause: IngestError;
}

/** Every way pinning or reading a triage card fails. */
export type TriageCardError =
  TriageCardNotPinnedError | TriageCardAlreadyPinnedError | TriageCardMalformedError | TriageCardIoError;

/** How to raise one. */
export const TriageCardErrors = {
  alreadyPinned: ({ slug }: { slug: string }): TriageCardAlreadyPinnedError => ({
    code: "CARD_ALREADY_PINNED",
    message: `a card is already pinned as ${slug}, and a pin is written once — card the group under a new slug`,
    slug,
  }),
  io: ({ cause }: { cause: IngestError }): TriageCardIoError => ({ cause, code: "CARD_IO", message: cause.message }),
  malformed: ({ slug }: { slug: string }): TriageCardMalformedError => ({
    code: "CARD_MALFORMED",
    message: `the pin for card ${slug} is not a pin — act on nothing, and card the group again`,
    slug,
  }),
  notPinned: ({ slug }: { slug: string }): TriageCardNotPinnedError => ({
    code: "CARD_NOT_PINNED",
    message: `no ids are pinned for card ${slug} — act on nothing, and card the group again`,
    slug,
  }),
} as const;

/**
 * The directory the pins live in, made if absent and forced to `0700` either way — a mode given to `mkdir` only
 * reaches a directory it creates, so the directory is tightened explicitly every time.
 */
function ensureTriageCardsDirectory({ home }: { home: string }): Result<string, IngestError> {
  const directory = stateHomePaths({ home }).live.gmail.triageCards;
  return safeFs({
    execute: () => {
      ensureDirectory({ directory });
      chmodSync(directory, 0o700);
      return directory;
    },
    operation: "ensureTriageCardsDirectory",
    path: directory,
  });
}

/**
 * Pin a card's ids, once.
 *
 * @param card the set to pin; its slug names the file
 * @param home the state home
 * @returns the path written, or why nothing was
 */
export function pinTriageCard({
  card,
  home,
}: {
  card: GmailTriageCard;
  home: string;
}): Result<{ readonly path: string }, TriageCardError> {
  const directory = ensureTriageCardsDirectory({ home });
  if (directory.isErr()) {
    return err(TriageCardErrors.io({ cause: directory.error }));
  }
  const path = join(directory.value, `${card.slug}.json`);
  const contents = `${safeJsonStringify({ label: "gmail triage card", space: 2, value: card })}\n`;
  const written = safeFs({
    execute: () => {
      createFileExclusive({ contents, path });
      chmodSync(path, 0o600);
      return { path };
    },
    operation: "pinTriageCard",
    path,
  });
  if (written.isErr()) {
    if (written.error.code === "EEXIST") {
      return err(TriageCardErrors.alreadyPinned({ slug: card.slug }));
    }
    return err(TriageCardErrors.io({ cause: written.error }));
  }
  return ok(written.value);
}

/**
 * Read a card's pinned set.
 *
 * @param slug the card slug it was pinned under
 * @param home the state home
 * @returns the pin, or which of absent, malformed or unreadable it was
 */
export function readTriageCard({
  slug,
  home,
}: {
  slug: string;
  home: string;
}): Result<GmailTriageCard, TriageCardError> {
  const path = join(stateHomePaths({ home }).live.gmail.triageCards, `${slug}.json`);
  const text = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "readTriageCard", path });
  if (text.isErr()) {
    if (text.error.code === "ENOENT") {
      return err(TriageCardErrors.notPinned({ slug }));
    }
    return err(TriageCardErrors.io({ cause: text.error }));
  }
  const parsed = safeFs({
    execute: () => safeJsonParse({ label: "gmail triage card", text: text.value }),
    operation: "readTriageCard",
    path,
  });
  if (parsed.isErr()) {
    return err(TriageCardErrors.malformed({ slug }));
  }
  const card = CARD_SCHEMA.safeParse(parsed.value);
  if (!card.success || card.data.slug !== slug) {
    return err(TriageCardErrors.malformed({ slug }));
  }
  return ok(card.data);
}
