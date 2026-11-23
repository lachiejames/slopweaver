/**
 * When the owner last actually signed each plan store in — the append-only record that makes the owner's own
 * definition of done measurable by them.
 *
 * ## The hole this fills, and why no existing file could have filled it
 *
 * The acceptance test for the sign-in workstream is about RECENCY: how long has it been since the owner last
 * signed in, and when are they next forced to. Neither number existed anywhere. `identityAssertions.ts`'s
 * `assertedAtIso` looks like the first one and is not: `establishAssertion` only ever ADDS, so an ordinary
 * sign-in into an already-enrolled store writes nothing at all. MEASURED on one install:
 * plan-two and plan-three still read their original `assertedAtIso` a full day after the owner signed both of
 * them in.
 *
 * Making `assertedAtIso` move on every sign-in would have been the wrong repair, and `identityAssertions.ts`'s
 * own header says why in advance — a field a sweep can write is a field a sweep will overwrite, which is
 * exactly how `recordStoreIdentity` came to erase the evidence of its own drift. So this is a SEPARATE FILE
 * WITH A SEPARATE WRITER, the same shape that file chose for the same reason, one step further on: it is
 * APPEND-ONLY, so it cannot erase its own history even in principle.
 *
 * ## Tolerant reading is safe HERE, and that is a property of append-only rather than a preference
 *
 * {@link parseSignInLine} answers `undefined` for a line it cannot decode, and {@link readSignIns} skips it
 * rather than refusing the file — matching `parseIdentityAssertions`. For the assertions file that tolerance
 * needed a strict counterpart (`readAssertionsForWrite`), because every enrollment rewrites the WHOLE list
 * and a list read as empty would silently drop every row the reader could not parse. **No path rewrites this
 * file**, so a dropped line costs exactly that line and can never be amplified into a lost record. Do not
 * "fix" this into a strict read.
 *
 * ## Two things the reader deliberately does not do
 *
 * It does not refuse an alias that is no longer configured. This is a historical record, and a plan leaving
 * `accounts.json` does not make the past false — the opposite call from `readAssertionsForWrite`, for the
 * reason above. And {@link lastSignInByAlias} takes the LAST matching row in FILE ORDER rather than the
 * largest instant, so a machine whose clock jumped backwards cannot hide its own most recent append behind an
 * older row that happens to carry a later timestamp.
 *
 * The read goes through `readJsonlLines` from the first commit rather than being converted once it gets big,
 * the same call `goldDebt/store.ts` made for the same reason: a `.jsonl` read whole is the shape
 * `whole-file-json` names, and its debt list only ever shrinks.
 */
import { mkdirSync } from "node:fs";

import type { IngestError } from "#lib/ingestError.js";
import type { Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { isRecord } from "../lib/parsers.js";
import type { ClaudeAccountAlias } from "./contracts.js";

/** Owner-only permissions — this names which accounts exist on the machine. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The directory every claude-account file lives under, relative to the Slopweaver home. */
const ACCOUNTS_DIR = "claude-accounts";

/** The log's own name inside {@link ACCOUNTS_DIR}. */
const LOG_FILE = "sign-in-log.jsonl";

/**
 * One sign-in the verb actually performed: which store, and when the vendor's own login exited cleanly.
 *
 * Carries no organisation id, no email and no credential — the same bound every renderable type in this
 * feature holds, and for the same reason: a type that cannot hold a private identifier cannot leak one.
 */
export interface ClaudeSignIn {
  readonly alias: ClaudeAccountAlias;
  /** When the vendor's `auth login` exited cleanly for this store, ISO-8601. */
  readonly signedInAtIso: string;
}

/**
 * The log's absolute path.
 *
 * @param home the Slopweaver home to resolve under
 * @returns the path to `claude-accounts/sign-in-log.jsonl`
 */
export function signInLogPath({ home }: { home: string }): string {
  return `${home}/${ACCOUNTS_DIR}/${LOG_FILE}`;
}

/**
 * Decode one recorded line, answering nothing for anything unrecognisable.
 *
 * @param line one line of the log, as read
 * @returns the sign-in it records, or undefined when this line records none
 */
export function parseSignInLine({ line }: { line: string }): ClaudeSignIn | undefined {
  const trimmed = line.trim();
  if (trimmed === "") {
    return undefined;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!isRecord(decoded)) {
    return undefined;
  }
  const alias = decoded["alias"];
  const signedInAtIso = decoded["signedInAtIso"];
  if (typeof alias !== "string" || typeof signedInAtIso !== "string" || alias === "" || signedInAtIso === "") {
    return undefined;
  }
  return { alias, signedInAtIso };
}

/**
 * The most recent recorded sign-in for one store, when the log holds one.
 *
 * Takes the LAST matching row in file order rather than the largest instant — see the file header's § Two
 * things the reader deliberately does not do.
 *
 * @param alias the store to look up
 * @param signIns every recorded sign-in, in file order
 * @returns the instant of its newest recorded sign-in, or undefined when none was recorded for it
 */
export function lastSignInByAlias({
  alias,
  signIns,
}: {
  alias: ClaudeAccountAlias;
  signIns: readonly ClaudeSignIn[];
}): string | undefined {
  return signIns.findLast((entry) => entry.alias === alias)?.signedInAtIso;
}

/**
 * Every sign-in the log holds, tolerating an absent or unreadable file.
 *
 * Swallowing a read failure is right here in a way it is not for an enrollment write: a missing recency
 * record must leave a row saying it has nothing to report, never stop the surface that keeps every credential
 * alive.
 *
 * @param home the Slopweaver home to read under
 * @returns the decodable sign-ins, in file order; empty when the log is absent or unreadable
 */
export function readSignIns({ home }: { home: string }): readonly ClaudeSignIn[] {
  const signIns: ClaudeSignIn[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        const parsed = parseSignInLine({ line });
        if (parsed !== undefined) {
          signIns.push(parsed);
        }
      },
      path: signInLogPath({ home }),
    });
  } catch {
    return [];
  }
  return signIns;
}

/**
 * Record one sign-in, creating the log if needed.
 *
 * Called IMMEDIATELY after the vendor's own login exits cleanly and before anything verifies what landed,
 * because every check after that point — the re-probe, the identity comparison, the `identity-reenroll`
 * refusal — can fail on a store the owner genuinely just signed into, and those are exactly the cases where they need
 * to see the sign-in recorded.
 *
 * **It reports a write failure rather than throwing**, and that is what keeps the record SUBORDINATE to the
 * sign-in it describes. This runs between a completed browser login and the enrollment that binds the store's
 * identity, so a raw `mkdirSync` throw here threw away up to ten minutes of the owner's own browser login and
 * left the store signed in but unenrolled — the credential live on disk with nothing bound to it, recoverable
 * only by doing the whole login again. MEASURED against a home chmod'd `0o500`: `EACCES:
 * permission denied, mkdir '<home>/claude-accounts'`. The log's value is wording on `--status`; a nicety may
 * be skipped, never veto the work it annotates. The caller says the substitution out loud.
 *
 * @param alias the store that was just signed into
 * @param home the Slopweaver home to write under
 * @param nowIso when the login completed, ISO-8601 — injected, never read from a hidden clock
 * @returns nothing on success, or the typed filesystem failure for the caller to report
 */
export function appendSignIn({
  alias,
  home,
  nowIso,
}: {
  alias: ClaudeAccountAlias;
  home: string;
  nowIso: string;
}): Result<void, IngestError> {
  const path = signInLogPath({ home });
  const entry: ClaudeSignIn = { alias, signedInAtIso: nowIso };
  return safeFs({
    execute: () => {
      mkdirSync(`${home}/${ACCOUNTS_DIR}`, { mode: DIR_MODE, recursive: true });
      appendLines({ mode: FILE_MODE, path, text: `${JSON.stringify(entry)}\n` });
    },
    operation: "appendSignIn",
    path,
  });
}
