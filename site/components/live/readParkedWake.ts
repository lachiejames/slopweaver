/**
 * What a board row's closed seat waits on, read off the `parked` checkpoint `handover list --json` publishes
 * (`src/cli/commands/handover/listJsonWait.ts`): a clock (`handover park --wake-at`) or one pull request's CI
 * (`--wake-on-checks`). The wire shape is `src/handover/parkWake.ts`'s `ParkWake`, restated here because `site/`
 * imports nothing from `src/`.
 *
 * A park with no `wake` waits on the owner, and is the Queue's to show, so it reads as no wake at all. A wake that is present
 * and will not read is carried as `unread`: counted and said on the Fleet page, never dropped, and never a reason to
 * refuse the whole board over one row's checkpoint.
 */
import { type Bag, isBag } from "../../lib/bag";

/** What a parked row's closed seat waits on, or that a present wake would not read. */
export type BoardParkedWake =
  | { readonly kind: "at"; readonly atIso: string }
  | { readonly kind: "checks"; readonly repo: string; readonly number: number }
  | { readonly kind: "unread" };

/** One UTC instant as `handover park --wake-at` accepts it: seconds, an optional fraction, and `Z`. */
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** `owner/name`, as the journal stores a checks wake's repository. */
const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** A wake that is present and does not read. */
const UNREAD: BoardParkedWake = { kind: "unread" };

/**
 * Whether a text is one real UTC instant: the shape, and a calendar that does not roll over (`02-30` is not one). Every
 * instant the parked count joins or orders on is held to it, the wake reading's stamps included.
 *
 * @returns true when it names exactly one instant
 */
export function isUtcInstant({ text }: { text: string }): boolean {
  if (!UTC_INSTANT.test(text)) {
    return false;
  }
  const ms = Date.parse(text);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 19) === text.slice(0, 19);
}

/**
 * One journalled wake, exactly one of the two arms with exactly its keys, else `unread` — the board's checkpoint and
 * the wake reading's rows are both held to it, so the two producers' wakes read by one rule.
 *
 * @param raw the `wake` field as published
 * @returns the wake
 */
export function wakeOf({ raw }: { raw: unknown }): BoardParkedWake {
  if (!isBag(raw)) {
    return UNREAD;
  }
  const keys = Object.keys(raw).toSorted().join(",");
  const { atIso, kind, number, repo } = raw;
  if (kind === "at" && keys === "atIso,kind" && typeof atIso === "string" && isUtcInstant({ text: atIso })) {
    return { atIso, kind: "at" };
  }
  if (kind !== "checks" || keys !== "kind,number,repo" || typeof repo !== "string" || typeof number !== "number") {
    return UNREAD;
  }
  if (!REPO_SLUG.test(repo) || !Number.isSafeInteger(number) || number < 1) {
    return UNREAD;
  }
  return { kind: "checks", number, repo };
}

/**
 * The wake a published board row's parked checkpoint carries.
 *
 * @param row the published board row
 * @returns the wake, `unread` when a present checkpoint or wake will not read, or `undefined` when the row is not
 *   parked or is parked on the owner
 */
export function parkedWakeOf({ row }: { row: Bag }): BoardParkedWake | undefined {
  const parked: unknown = row["parked"];
  if (parked === undefined) {
    return undefined;
  }
  if (!isBag(parked)) {
    return UNREAD;
  }
  if (!Object.hasOwn(parked, "wake")) {
    return undefined;
  }
  return wakeOf({ raw: parked["wake"] });
}

/**
 * Whether a row carries a parked checkpoint at all, and whether it names a wake — what {@link parkedWakeOf} cannot
 * say, since it answers `undefined` both for no park and for a park with no wake. A park with no wake on a row that
 * is not waiting on the owner is a closed seat waiting on nothing: the Fleet page's doctrine panel counts it.
 */
export type BoardParkedCheckpoint = "wake" | "no-wake" | "unread";

/** The keys `publishedParkedOf` always writes (`src/cli/commands/handover/listJsonWait.ts`); `drafts` and `wake` are optional. */
const ALWAYS_PUBLISHED = ["atIso", "branch", "screenTail", "workspaceRef", "worktree"] as const;

/**
 * The parked checkpoint a published board row carries.
 *
 * @param row the published board row
 * @returns `wake`, `no-wake`, `unread` when the checkpoint is not an object or its wake will not read, or
 *   `undefined` when the row carries no checkpoint
 */
export function parkedCheckpointOf({ row }: { row: Bag }): BoardParkedCheckpoint | undefined {
  const parked: unknown = row["parked"];
  if (parked === undefined) {
    return undefined;
  }
  if (!isBag(parked)) {
    return "unread";
  }
  if (!Object.hasOwn(parked, "wake")) {
    // A checkpoint missing a key the publisher always writes is partial, and could have lost a wake too.
    // Each is a string on `ParkedEvent` (`src/handover/parkedEvent.ts`), so present is not enough.
    return ALWAYS_PUBLISHED.every((key) => typeof parked[key] === "string") ? "no-wake" : "unread";
  }
  // A wake that will not read is not a wake the seat is known to wait on.
  return wakeOf({ raw: parked["wake"] }).kind === "unread" ? "unread" : "wake";
}

/**
 * The instant the row's standing park was journalled, as `publishedParkedOf` writes it — checked beside the park's
 * journal index ({@link parkIndexOf}), so a reading of an earlier park on the same row is never read as this one's.
 *
 * @param row the published board row
 * @returns the instant, or `undefined` when the row carries no checkpoint or its instant is not a real one
 */
export function parkedAtIsoOf({ row }: { row: Bag }): string | undefined {
  const parked: unknown = row["parked"];
  if (!isBag(parked)) {
    return undefined;
  }
  const { atIso } = parked;
  if (typeof atIso !== "string" || !isUtcInstant({ text: atIso })) {
    return undefined;
  }
  return atIso;
}

/** The greatest index a JavaScript array can hold, so the greatest `events.indexOf` can answer: 2^32 - 2. */
const MAX_ARRAY_INDEX = 4_294_967_294;

/**
 * Whether a value is one `events.indexOf` could have answered for a park it found: an integer from 0 to
 * {@link MAX_ARRAY_INDEX}.
 *
 * @param value the published `parkIndex`
 * @returns true when it can name a journal event
 */
export function isJournalIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_ARRAY_INDEX;
}

/**
 * Where a parked row's standing park sits in its decoded journal — with the slug, the park's identity, and the
 * same index `handover wake --json` reports on its own row for that park.
 *
 * @param row a `handover list --json` row
 * @returns the non-negative integer index, or `undefined` when the row carries no parked checkpoint or a malformed one
 */
export function parkIndexOf({ row }: { row: Bag }): number | undefined {
  const parked: unknown = row["parked"];
  if (!isBag(parked)) {
    return undefined;
  }
  const { parkIndex } = parked;
  if (!isJournalIndex(parkIndex)) {
    return undefined;
  }
  return parkIndex;
}
