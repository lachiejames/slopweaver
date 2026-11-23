/**
 * The card-spend register on disk: `$SLOPWEAVER_HOME/spend/cards/<provider>-<last4>/<asOf>.json`, one file per
 * imported export, the newest capture day read back as the card's current picture.
 *
 * ## Why one file per export rather than one merged card
 *
 * A page carries a limited window of rows and no row id — four identical declines on one day are four
 * identical rows — so merging two exports cannot tell a repeated row from a new one, and replacing the card
 * wholesale would drop whatever an older page showed and a newer one scrolled past. Keeping each export as
 * it was pasted loses nothing, and re-importing the same day replaces that one file, so an import repeats
 * safely. State, never code: nothing here is committed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import { type SpendError, SpendErrors } from "./errors.js";
import { isIsoDay } from "./exportLines.js";
import type { CardSnapshot } from "./types.js";

/** Owner-only, like every other register holding the organisation's own records. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** One amount on disk. */
const MONEY = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), minor: z.number().int() });

/** A real calendar day on disk. */
const DAY = z.string().refine((text) => isIsoDay({ text }), { message: "not a real YYYY-MM-DD day" });

/** A stored snapshot, validated field by field on every read. */
const CARD_SNAPSHOT = z.object({
  asOf: DAY,
  last4: z.string().regex(/^\d{4}$/),
  merchantAllow: z.array(z.string()).nullable(),
  monthly: z.object({ limit: MONEY, resetNote: z.string().nullable(), resetsOn: DAY, used: MONEY }),
  nickname: z.string(),
  organisation: z.string(),
  provider: z.literal("airwallex"),
  schemaVersion: z.literal(1),
  source: z.object({ importedAt: z.string(), kind: z.enum(["pasted", "live"]), path: z.string() }),
  transactionLimit: MONEY,
  transactions: z.array(
    z.object({
      amount: MONEY,
      date: DAY,
      declineReason: z.string().exactOptional(),
      merchant: z.string(),
      ordinal: z.number().int(),
      status: z.enum(["charged", "declined", "cancelled", "card-verification"]),
    }),
  ),
});

/**
 * The directory one card's snapshots live in.
 *
 * @param home the Slopweaver home
 * @param provider the card's provider
 * @param last4 the card's last four digits
 * @returns the card's directory
 */
export function cardDirectory({ home, last4, provider }: { home: string; last4: string; provider: string }): string {
  return join(stateHomePaths({ home }).spendCards, `${provider}-${last4}`);
}

/**
 * Write one snapshot, replacing any earlier import of the same card on the same capture day.
 *
 * @param home the Slopweaver home
 * @param snapshot the snapshot to store
 * @returns the path written, or why it could not be
 */
export function writeCardSnapshot({
  home,
  snapshot,
}: {
  home: string;
  snapshot: CardSnapshot;
}): Result<string, SpendError> {
  const path = join(
    cardDirectory({ home, last4: snapshot.last4, provider: snapshot.provider }),
    `${snapshot.asOf}.json`,
  );
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: `spend snapshot ${path}`, space: 2, value: snapshot })}\n`,
      dirMode: DIR_MODE,
      fileMode: FILE_MODE,
      path,
    });
  } catch (error: unknown) {
    return err(SpendErrors.snapshotWriteFailed({ cause: errorMessage({ error }), path }));
  }
  return ok(path);
}

/**
 * Read and validate one stored snapshot.
 *
 * @param path the snapshot file
 * @returns the snapshot, or why it cannot be trusted
 */
function readSnapshot({ path }: { path: string }): Result<CardSnapshot, SpendError> {
  let raw: unknown;
  try {
    raw = safeJsonParse({ label: `spend snapshot ${path}`, text: readFileSync(path, "utf8") });
  } catch (error: unknown) {
    return err(SpendErrors.snapshotUnreadable({ cause: errorMessage({ error }), path }));
  }
  const parsed = CARD_SNAPSHOT.safeParse(raw);
  if (!parsed.success) {
    return err(
      SpendErrors.snapshotInvalid({
        path,
        problems: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      }),
    );
  }
  const snapshot: CardSnapshot = parsed.data;
  return ok(snapshot);
}

/**
 * The entries of a directory, or none when it does not exist yet.
 *
 * @param directory the directory to list
 * @returns the entry names, sorted
 */
function entriesOf({ directory }: { directory: string }): readonly string[] {
  try {
    return readdirSync(directory).toSorted();
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * The newest snapshot of every imported card, or of the one card asked for.
 *
 * @param home the Slopweaver home
 * @param last4 the one card to read, or undefined for every card
 * @returns one snapshot per card, empty when nothing has been imported; `CARD_NOT_FOUND` for a named card never imported
 */
export function readLatestSnapshots({
  home,
  last4,
}: {
  home: string;
  last4: string | undefined;
}): Result<readonly CardSnapshot[], SpendError> {
  const root = stateHomePaths({ home }).spendCards;
  const cards = entriesOf({ directory: root });
  const wanted = cards.filter((card) => last4 === undefined || card.endsWith(`-${last4}`));
  if (last4 !== undefined && wanted.length === 0) {
    return err(SpendErrors.cardNotFound({ held: cards, last4 }));
  }
  const snapshots: CardSnapshot[] = [];
  for (const card of wanted) {
    const newest = entriesOf({ directory: join(root, card) }).findLast((name) => name.endsWith(".json"));
    if (newest === undefined) {
      continue;
    }
    const snapshot = readSnapshot({ path: join(root, card, newest) });
    if (snapshot.isErr()) {
      return err(snapshot.error);
    }
    snapshots.push(snapshot.value);
  }
  return ok(snapshots);
}
