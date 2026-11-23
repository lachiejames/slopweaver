/**
 * The sign-in probe ledger: every `browser sign-in` look at a Datadog or GitHub session in the owner's Chrome, and what it
 * found — signed in, a wall the fleet presses, or a step only the owner's hands can take.
 *
 * It exists for the card gate (`../handover/fleetSignInGate.ts`). The failure it prevents is a Queue card asking
 * the owner to sign in to Datadog that no look had ever stood behind; a card may now ask that only when this ledger holds
 * a fresh row for the provider whose verdict is the owner's own step, which only a look that reached such a wall can write.
 *
 * One append-only `ledgers/sign-in-probes.jsonl`, owner-only, read back by streaming. A row carries the page's
 * origin and path and never its query, which on an identity page can hold a token.
 */
import { mkdirSync } from "node:fs";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonStringify } from "../lib/safeJson.js";
import { stateHomePaths } from "../stateHome.js";
import { SIGN_IN_PROVIDERS, type SignInProvider } from "./signInPress.js";

/** The verdict for a wall only the owner can pass. */
export const OWNER_HANDS_VERDICT = "owner-hands" as const;

/** What one look found. */
const SIGN_IN_PROBE_VERDICTS = ["signed-in", "pressable", OWNER_HANDS_VERDICT] as const;

/** One look's finding. */
type SignInProbeVerdict = (typeof SIGN_IN_PROBE_VERDICTS)[number];

/** The existing ledger could not be read, so no look can stand behind a card. */
interface ProbeLedgerUnreadableError {
  readonly code: "PROBE_LEDGER_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A look could not be written, so it backs no card. */
interface ProbeRecordFailedError {
  readonly code: "PROBE_RECORD_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Why the sign-in probe ledger could not be read or written. */
export type SignInProbeError = ProbeLedgerUnreadableError | ProbeRecordFailedError;

/** The factory for every {@link SignInProbeError}. */
export const SignInProbeErrors = {
  ledgerUnreadable: ({ path, cause }: { path: string; cause: unknown }): ProbeLedgerUnreadableError => ({
    code: "PROBE_LEDGER_UNREADABLE",
    message: `the sign-in probe ledger at ${path} could not be read: ${errorMessage({ error: cause })}`,
    path,
  }),
  recordFailed: ({ path, cause }: { path: string; cause: unknown }): ProbeRecordFailedError => ({
    code: "PROBE_RECORD_FAILED",
    message: `could not record the sign-in probe at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
} as const;

/** One row of the ledger. */
export interface SignInProbeRow {
  readonly provider: SignInProvider;
  readonly verdict: SignInProbeVerdict;
  /** What the look saw, in one sentence: the console's address, the button to press, or why it is the owner's. */
  readonly why: string;
  /** The page the look landed on, origin and path only. */
  readonly page: string;
  readonly atIso: string;
}

/**
 * A page address with its query and fragment dropped — what a row may carry.
 *
 * @param url the landed address
 * @returns origin and path, or the address unchanged when it does not parse
 */
export function probePage({ url }: { url: string }): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Decode one stored line, or `undefined` when it is not a row this build reads — a torn final line from a killed
 * writer is skipped rather than failing every reader after it.
 *
 * @param line one line of the ledger
 * @returns the row, or `undefined`
 */
export function parseSignInProbeLine({ line }: { line: string }): SignInProbeRow | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const { provider, verdict, why, page, atIso } = parsed;
  const knownProvider = SIGN_IN_PROVIDERS.find((one) => one === provider);
  const knownVerdict = SIGN_IN_PROBE_VERDICTS.find((one) => one === verdict);
  if (knownProvider === undefined || knownVerdict === undefined) {
    return undefined;
  }
  if (typeof why !== "string" || typeof page !== "string" || typeof atIso !== "string") {
    return undefined;
  }
  if (Number.isNaN(Date.parse(atIso))) {
    return undefined;
  }
  return { atIso, page, provider: knownProvider, verdict: knownVerdict, why };
}

/**
 * Every row the ledger holds, in written order. A ledger never written is empty.
 *
 * @param home the state home the ledger lives under
 * @returns the rows, or why an existing ledger could not be read
 */
export function readSignInProbes({ home }: { home: string }): Result<readonly SignInProbeRow[], SignInProbeError> {
  const path = stateHomePaths({ home }).signInProbesJsonl;
  const rows: SignInProbeRow[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        const row = parseSignInProbeLine({ line });
        if (row !== undefined) {
          rows.push(row);
        }
      },
      path,
    });
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return ok([]);
    }
    return err(SignInProbeErrors.ledgerUnreadable({ cause, path }));
  }
  return ok(rows);
}

/**
 * Append one look's finding, creating the ledger if it is not there yet.
 *
 * @param home the state home the ledger lives under
 * @param row the finding
 * @returns the path written, or why it could not be
 */
export function appendSignInProbe({
  home,
  row,
}: {
  home: string;
  row: SignInProbeRow;
}): Result<string, SignInProbeError> {
  const paths = stateHomePaths({ home });
  try {
    mkdirSync(paths.ledgers, { mode: 0o700, recursive: true });
    const encoded = safeJsonStringify({ label: "a sign-in probe row", value: row });
    appendLines({ mode: 0o600, path: paths.signInProbesJsonl, text: `${encoded}\n` });
    return ok(paths.signInProbesJsonl);
  } catch (cause) {
    return err(SignInProbeErrors.recordFailed({ cause, path: paths.signInProbesJsonl }));
  }
}
