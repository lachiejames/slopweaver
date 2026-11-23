/**
 * Where each firing that posted put its message — recorded by the executor when the post is confirmed, read by
 * the Automations page.
 *
 * ## Why a record and not a recomputation
 *
 * A scheduled post's door reservation is keyed by a digest of the actor, the channel and the slot's delivery key
 * (`../../outbound/slack/fingerprint.ts#duplicateKey`), so a reader COULD re-derive it. It would be wrong exactly
 * when it matters: the channel comes from the row's `params`, its `channelApprovals` and the profile's
 * `promptChannel`, every one of which can change after the firing, and the re-derived key then names a file that
 * does not exist. The reservation also carries no workspace, so it could never yield a link. So the executor,
 * which holds the admitted channel and the confirmed `ts` in hand, writes them down once, keyed by the firing.
 *
 * A firing from before this record existed has none, and the page says so rather than guessing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { slotAttemptKey } from "./slotLedger.js";

/** One firing's confirmed post. */
export interface FiringPosting {
  readonly recipeId: string;
  readonly slotIso: string;
  /** The conversation the post was admitted to. */
  readonly channel: string;
  /** The posted message's own ts, which is the thread any answer to it lands in. */
  readonly ts: string;
  readonly postedAtIso: string;
}

/** Where one firing's posting record lives. */
function postingPath({ home, recipeId, slotIso }: { home: string; recipeId: string; slotIso: string }): string {
  return join(stateHomePaths({ home }).live.recipe.postingsDir, `${slotAttemptKey({ recipeId, slotIso })}.json`);
}

/**
 * Record one firing's confirmed post. A second write for the same firing replaces the first, which is right: the
 * door refuses a second delivery of one firing, so a second confirmed ts is the same message read back.
 *
 * @param home the state home
 * @param posting what was posted, where and when
 * @returns nothing on success, or why the record could not be written
 */
export function recordFiringPosting({ home, posting }: { home: string; posting: FiringPosting }): Result<void> {
  const path = postingPath({ home, recipeId: posting.recipeId, slotIso: posting.slotIso });
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "firing posting", value: posting })}\n`,
      fileMode: 0o600,
      path,
    });
    return ok(undefined);
  } catch (cause) {
    return err([`the posting record at ${path} could not be written (${String(cause)})`]);
  }
}

/**
 * Decode a stored posting, or `undefined` when the value is not one.
 *
 * @param value the parsed file
 * @returns the posting
 */
function postingOf({ value }: { value: unknown }): FiringPosting | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { recipeId, slotIso, channel, ts, postedAtIso } = value;
  if (
    typeof recipeId !== "string" ||
    typeof slotIso !== "string" ||
    typeof channel !== "string" ||
    typeof ts !== "string" ||
    typeof postedAtIso !== "string"
  ) {
    return undefined;
  }
  return { channel, postedAtIso, recipeId, slotIso, ts };
}

/**
 * Read one firing's posting record: the posting, `undefined` when that firing recorded none, or why the file
 * there would not read. Reads only the one file the firing names, never the directory.
 *
 * @param home the state home
 * @param recipeId the row
 * @param slotIso the firing
 * @returns the posting, none, or the reason
 */
export function readFiringPosting({
  home,
  recipeId,
  slotIso,
}: {
  home: string;
  recipeId: string;
  slotIso: string;
}): Result<FiringPosting | undefined> {
  const path = postingPath({ home, recipeId, slotIso });
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return ok(undefined);
    }
    return err([`the posting record at ${path} will not read (${String(cause)})`]);
  }
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "firing posting", text });
  } catch (cause) {
    return err([`the posting record at ${path} is not JSON (${String(cause)})`]);
  }
  const posting = postingOf({ value: parsed });
  if (posting === undefined || posting.recipeId !== recipeId || posting.slotIso !== slotIso) {
    return err([`the posting record at ${path} is not this firing's posting`]);
  }
  return ok(posting);
}
