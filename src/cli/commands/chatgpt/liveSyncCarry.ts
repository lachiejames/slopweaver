/**
 * The listing `chatgpt live-sync` carries from one run to the next: `<live root>/listing-carry.json`, beside
 * `snapshots/`. A backfill is many runs, and each used to pay the whole listing again (one request per 28 chats)
 * before reading a single chat, spending the owner's rate limit on a list it already had.
 *
 * **What is carried.** Every chat the last completed walk named, and the instant that walk began. The next run lists
 * only what is NEWER than that instant: the listing is newest-update-first, so a page whose oldest chat last moved
 * before it began has nothing further down that changed since. What the walk found is laid over the carried list, and
 * the plan (`liveSyncPlan.ts`) reads the merged result against the snapshots exactly as before.
 *
 * **What it never does.** It is written only after a walk completed, so a stopped walk leaves the last carry standing.
 * It is trusted for {@link CARRY_MAX_AGE_MS} at most, after which a run lists the whole account again: that is what
 * catches a chat deleted on chatgpt.com (a carried chat the account no longer holds would otherwise be asked for and
 * refused every run) and a chat only the projects lane names. `--relist` forces the same walk at any age.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { type ChatgptError, ChatgptErrors } from "./errors.js";
import type { ListedChatgptConversation } from "./listing.js";

/**
 * The longest a carried listing is believed. A choice, not a measurement: a backfill of a couple of thousand chats is
 * hours of reading, so three days covers one finishing across several sessions while a deleted chat is dropped within
 * the week the owner would notice a stale history.
 *
 * @internal
 */
export const CARRY_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * How far before the carried walk's start the next walk reads on, so a clock a little behind ChatGPT's own, or a chat
 * updated while that walk was paging, is still listed again. A choice, well above the seconds a page takes.
 *
 * @internal
 */
export const CARRY_MARGIN_MS = 10 * 60 * 1000;

/** What a completed walk left for the next run. */
export interface ListingCarry {
  /** The instant that walk began: every chat it named existed by then, at the update it named. */
  readonly walkStartedIso: string;
  /**
   * The instant the last WHOLE-account walk began. The carry's age is read from here, never from `walkStartedIso`:
   * each carried run renews that, so an age taken from it would never reach the limit.
   */
  readonly wholeWalkStartedIso: string;
  readonly conversations: readonly ListedChatgptConversation[];
}

const carriedConversationSchema = z.strictObject({
  createdIso: z.string().min(1),
  id: z.string().min(1),
  lane: z.enum(["active", "archived", "project"]),
  projectId: z.string().min(1).nullable(),
  title: z.string().nullable(),
  updatedIso: z.string().min(1),
});

const carrySchema = z.strictObject({
  conversations: z.array(carriedConversationSchema),
  schemaVersion: z.literal(1),
  walkStartedIso: z.iso.datetime(),
  wholeWalkStartedIso: z.iso.datetime(),
});

/** Where the carry sits: the live copy's root, beside `snapshots/` and `as-of.json`. */
function carryPath({ root }: { root: string }): string {
  return join(root, "listing-carry.json");
}

/**
 * The instant a walk may stop reading older pages at, or `undefined` when it must list the whole account.
 *
 * @param carry what the last completed walk left, if anything
 * @param nowIso this run's clock
 * @param relist whether the owner asked for the whole account again
 * @returns the carried walk's start less {@link CARRY_MARGIN_MS} while the last whole walk is under
 *   {@link CARRY_MAX_AGE_MS} old, or `undefined` for a whole walk
 */
export function carryBoundaryIso({
  carry,
  nowIso,
  relist,
}: {
  carry: ListingCarry | undefined;
  nowIso: string;
  relist: boolean;
}): string | undefined {
  if (carry === undefined || relist) {
    return undefined;
  }
  const ageMs = Date.parse(nowIso) - Date.parse(carry.wholeWalkStartedIso);
  if (ageMs < 0 || ageMs > CARRY_MAX_AGE_MS) {
    return undefined;
  }
  return new Date(Date.parse(carry.walkStartedIso) - CARRY_MARGIN_MS).toISOString();
}

/**
 * The carried listing with what this walk found laid over it: a chat the walk named takes the walk's entry, one it
 * did not reach keeps the carried one. Each id appears once, its first entry kept, so a carry file edited to name a
 * chat twice can never make one run ask for it twice. Pure.
 *
 * @param carried every chat the last completed walk named
 * @param fresh every chat this walk named, newest first
 * @returns the walk's chats first, then the carried ones it did not name, one entry per id
 */
export function mergeListing({
  carried,
  fresh,
}: {
  carried: readonly ListedChatgptConversation[];
  fresh: readonly ListedChatgptConversation[];
}): readonly ListedChatgptConversation[] {
  const named = new Set<string>();
  return [...fresh, ...carried].filter((one) => {
    if (named.has(one.id)) {
      return false;
    }
    named.add(one.id);
    return true;
  });
}

/**
 * The carry the last completed walk left, `undefined` when none has.
 *
 * @param root the live copy's root, `CorpusPaths.chatgptLive`
 * @returns the carry, `undefined` when the file is genuinely absent, or why a file that is there cannot be believed
 */
export function readListingCarry({ root }: { root: string }): Result<ListingCarry | undefined, ChatgptError> {
  const path = carryPath({ root });
  let text: string;
  try {
    if (!lstatSync(path).isFile()) {
      return err(ChatgptErrors.fileFailed({ cause: "not a regular file; run with --relist to list again", path }));
    }
    text = readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (isAbsentError({ error, path })) {
      return ok(undefined);
    }
    return err(ChatgptErrors.fileFailed({ cause: error, path }));
  }
  let parsed: z.ZodSafeParseResult<z.infer<typeof carrySchema>>;
  try {
    parsed = carrySchema.safeParse(safeJsonParse({ label: "the live-sync listing carry", text }));
  } catch (error: unknown) {
    return err(ChatgptErrors.fileFailed({ cause: `${String(error)}; run with --relist to list again`, path }));
  }
  if (!parsed.success) {
    return err(ChatgptErrors.fileFailed({ cause: "not a record this writes; run with --relist to list again", path }));
  }
  const { conversations, walkStartedIso, wholeWalkStartedIso } = parsed.data;
  return ok({ conversations, walkStartedIso, wholeWalkStartedIso });
}

/**
 * Hold what a completed walk named, for the next run.
 *
 * @param root the live copy's root, `CorpusPaths.chatgptLive`
 * @param carry the walk's start and every chat it named, merged over the carry it read
 * @returns nothing, or why the file could not be written
 */
export function writeListingCarry({ root, carry }: { root: string; carry: ListingCarry }): Result<void, ChatgptError> {
  const path = carryPath({ root });
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "the live-sync listing carry", value: { ...carry, schemaVersion: 1 } })}\n`,
      dirMode: 0o700,
      fileMode: 0o600,
      path,
    });
    return ok(undefined);
  } catch (error: unknown) {
    return err(ChatgptErrors.fileFailed({ cause: error, path }));
  }
}
