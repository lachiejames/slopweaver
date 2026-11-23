/**
 * Reading the autonomy register FILE — the source of the one-time import, never the ledger.
 *
 * The ledger is the store (`./port.ts`). `$SLOPWEAVER_HOME/ledgers/autonomy.jsonl` is what an install wrote before
 * the store held it, and exactly two things read it: `slopweaver store import-fleet --only autonomy`, which copies
 * it into the store once, and `slopweaver autonomy adopt`, which repairs hand-appended rows in it so that import
 * can take them. Nothing writes it any more, and once the store has imported it the file may be deleted.
 *
 * ## An unreadable FILE refuses rather than reporting empty
 *
 * Same call as `../knowledge/store.ts`: an import that read "no acts" because the file could not be reached would
 * mark the store imported over an empty ledger, and every act the fleet recorded would vanish from the Fleet
 * Briefing behind a confident "nothing was done for you".
 *
 * ## A bad LINE is skipped and reported, never a refusal of the file
 *
 * One undecodable line refusing the whole read would block the import over a single bad row. So a line that will
 * not decode is SKIPPED and carried out of the read in {@link AutonomyRegisterRead}'s `unparsed`, which is what lets the
 * import name every refused line in one pass and lets `autonomy adopt` repair them.
 *
 * ## Why the file is streamed rather than read whole
 *
 * `.claude/rules/typescript-patterns.md`: a `.jsonl` read whole is one of three shapes the `whole-file-json` gate
 * refuses, because its size is a property of the DATA.
 */
import { statSync } from "node:fs";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isAbsentError } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";

import { parseAutonomyLine } from "./decode.js";
import { type AutonomyError, AutonomyErrors, type CorruptRowError } from "./errors.js";
import type { AutonomyRecord, AutonomyRegisterRead } from "./types.js";

/**
 * The operation-lock key `autonomy adopt` and the store import both take, so a repair never rewrites the file
 * while an import is reading it.
 */
export const AUTONOMY_REGISTER_LOCK_KEY = "autonomy-ledger";

/**
 * Whether a register is there, genuinely absent, or present-but-unreachable.
 *
 * `existsSync` cannot answer this. It swallows every error and answers `false`, so a register whose DIRECTORY the
 * caller cannot traverse — `chmod 0600 ledgers/`, an ACL, a stale mount — reads identically to a fresh install.
 * So the presence check is a `statSync` whose
 * ENOENT is the ONLY answer that means absent — and only an ENOENT with nothing, not even a dangling symlink,
 * standing on the way to the path.
 *
 * @param path the register file
 * @returns `present` when it is there, `absent` when nothing is at that path, `unreachable` otherwise
 */
function registerPresence({ path }: { path: string }): "present" | "absent" | "unreachable" {
  try {
    statSync(path);
    return "present";
  } catch (error: unknown) {
    return isAbsentError({ error, path }) ? "absent" : "unreachable";
  }
}

/**
 * Every record one register file holds, in the order they were written, plus every line that was not one.
 *
 * @param path the file to read
 * @param missing whether an absent file is empty or an error
 * @returns the records and the skipped lines, or the failure the FILE itself raised
 */
export function readAutonomyRegisterFile({
  path,
  missing,
}: {
  path: string;
  missing: "empty" | "error";
}): Result<AutonomyRegisterRead, AutonomyError> {
  const presence = registerPresence({ path });
  if (presence === "unreachable") {
    return err(
      AutonomyErrors.storeUnreadable({ cause: "the register could not be reached — check its permissions", path }),
    );
  }
  if (presence === "absent") {
    if (missing === "empty") {
      return ok({ records: [], unparsed: [] });
    }
    return err(AutonomyErrors.storeUnreadable({ cause: "the file does not exist", path }));
  }
  const records: AutonomyRecord[] = [];
  const unparsed: CorruptRowError[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (line.trim().length === 0) {
          return;
        }
        const parsed = parseAutonomyLine({ line, lineNumber: index + 1 });
        if (parsed.isErr()) {
          unparsed.push(parsed.error);
          return;
        }
        records.push(parsed.value);
      },
      path,
    });
  } catch (cause) {
    return err(AutonomyErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  return ok({ records, unparsed });
}
