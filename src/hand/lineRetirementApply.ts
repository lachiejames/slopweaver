/**
 * The effectful half of `hand line-retire`: scan the register once, digesting the very bytes its lines came from, then
 * plan (`./lineRetirement.ts`) — and, on apply, append the retirement rows under the register's own lock.
 *
 * The register is never written. The apply re-checks the digest the preview printed UNDER the lock, so a line appended
 * between the two refuses rather than being judged against a plan made over different bytes, and it reads the
 * register back afterwards through the ordinary reader to prove each retired line has left `unparsed`.
 */
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";

import { readJsonlDescriptorLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isAbsentError } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonStringify } from "../lib/safeJson.js";
import { type LineRetireError, LineRetireErrors } from "./lineRetireErrors.js";
import {
  buildLineRetirement,
  type LineRetirement,
  lineSha256,
  planUnreadableLineRetirements,
  type RetirementPlan,
  type ScannedLine,
} from "./lineRetirement.js";
import { readLineRetirements, retirementSidecarPath } from "./lineRetirementSidecar.js";
import { skippedLines } from "./postingChecks.js";
import { rowsOfLine } from "./row.js";
import { handRegisterPath, readHandRows, underLock } from "./store.js";

/** Owner-only, as the register itself is: a retirement quotes a step id and the operator's reason. */
const FILE_MODE = 0o600;

/**
 * One scan of the register: every non-blank line, and the digest of the whole file the lines came from.
 *
 * @internal
 */
export interface RegisterScan {
  readonly lines: readonly ScannedLine[];
  readonly sourceSha256: string;
}

/** What a preview found. */
export interface LineRetirePreview {
  readonly path: string;
  readonly sourceSha256: string;
  readonly plan: RetirementPlan;
}

/** What an apply wrote, and what the read-back found. */
export interface LineRetireApplied {
  readonly sidecarPath: string;
  readonly written: readonly LineRetirement[];
  readonly plan: RetirementPlan;
  /** How many lines the ordinary reader still skips after the append. */
  readonly unparsedAfter: number;
}

/**
 * Scan one register file: each non-blank line hashed and parsed, and the sha256 of every byte read.
 *
 * @param path the register file
 * @returns the scan — empty, digesting nothing, when the file is absent — or why it would not read
 * @internal
 */
export function scanRegister({ path }: { path: string }): Result<RegisterScan, LineRetireError> {
  const digest = createHash("sha256");
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (cause) {
    if (isAbsentError({ error: cause, path })) {
      return ok({ lines: [], sourceSha256: digest.digest("hex") });
    }
    return err(LineRetireErrors.registerUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  const lines: ScannedLine[] = [];
  try {
    readJsonlDescriptorLines({
      fd,
      onBytes: ({ bytes }) => {
        digest.update(bytes);
      },
      onLine: ({ line, index }) => {
        if (line.trim().length === 0) {
          return;
        }
        const lineNumber = index + 1;
        const sha256 = lineSha256({ text: line });
        // Strict decoding makes the hash one of the raw bytes: a line that is not UTF-8 arrives as a lone
        // U+FFFD no JSON parses as, so it is never eligible, and never a repaired text two byte runs share.
        const parsed = rowsOfLine({ line, lineNumber });
        lines.push(
          parsed.isOk()
            ? { lineNumber, readable: true, rows: parsed.value, sha256, text: line }
            : { lineNumber, readable: false, sha256, text: line },
        );
      },
      strictUtf8: true,
    });
  } catch (cause) {
    return err(LineRetireErrors.registerUnreadable({ cause: errorMessage({ error: cause }), path }));
  } finally {
    closeSync(fd);
  }
  return ok({ lines, sourceSha256: digest.digest("hex") });
}

/**
 * Plan over one register file and the retirements already beside it.
 *
 * @param path the register file
 * @returns the preview, or why the register would not read
 */
function previewAt({ path }: { path: string }): Result<LineRetirePreview, LineRetireError> {
  return scanRegister({ path }).map((scan) => ({
    path,
    plan: planUnreadableLineRetirements({
      lines: scan.lines,
      retirements: readLineRetirements({ registerPath: path }),
    }),
    sourceSha256: scan.sourceSha256,
  }));
}

/**
 * What `hand line-retire` would retire, read-only: which unreadable lines are provably settled, which are not and why,
 * and the digest an apply must carry.
 *
 * @param home the state home
 * @returns the preview, or why the register would not read
 */
export function previewLineRetirements({ home }: { home: string }): Result<LineRetirePreview, LineRetireError> {
  return previewAt({ path: handRegisterPath({ home }) });
}

/**
 * Append a retirement row for every eligible line, under the register's lock, against the digest the preview printed.
 *
 * @param home the state home
 * @param nowIso when, for the lock and the rows
 * @param sourceSha256 the register digest the preview printed
 * @param reason why the operator is retiring them
 * @param bySession the visible session, or `null` outside one
 * @returns what was written and what the read-back found, or the refusal
 */
export function applyLineRetirements({
  home,
  nowIso,
  sourceSha256,
  reason,
  bySession,
}: {
  home: string;
  nowIso: string;
  sourceSha256: string;
  reason: string;
  bySession: string | null;
}): Result<LineRetireApplied, LineRetireError> {
  const locked = underLock({
    home,
    nowIso,
    section: (path) => ok(retireUnderLock({ bySession, nowIso, path, reason, sourceSha256 })),
  });
  if (locked.isErr()) {
    return err(LineRetireErrors.registerUnreadable({ cause: locked.error.message, path: handRegisterPath({ home }) }));
  }
  return locked.value;
}

/**
 * The critical section: re-scan, check the digest, append, read back.
 *
 * @param path the register file
 * @returns what was written, or the refusal
 */
function retireUnderLock({
  path,
  nowIso,
  sourceSha256,
  reason,
  bySession,
}: {
  path: string;
  nowIso: string;
  sourceSha256: string;
  reason: string;
  bySession: string | null;
}): Result<LineRetireApplied, LineRetireError> {
  const preview = previewAt({ path });
  if (preview.isErr()) {
    return err(preview.error);
  }
  if (preview.value.sourceSha256 !== sourceSha256) {
    return err(LineRetireErrors.sourceChanged({ actual: preview.value.sourceSha256, expected: sourceSha256 }));
  }
  const { plan } = preview.value;
  if (plan.eligible.length === 0) {
    return err(LineRetireErrors.nothingEligible());
  }
  const written = plan.eligible.map((candidate) =>
    buildLineRetirement({ bySession, candidate, reason, retiredIso: nowIso, sourceSha256 }),
  );
  const sidecarPath = retirementSidecarPath({ registerPath: path });
  // The register's directory, which `underLock` has already made.
  try {
    const text = written
      .map((row) => safeJsonStringify({ label: "a hand-step line retirement", value: row }))
      .join("\n");
    appendLines({ durable: true, mode: FILE_MODE, path: sidecarPath, text: `${text}\n` });
  } catch (cause) {
    return err(LineRetireErrors.writeFailed({ cause: errorMessage({ error: cause }), path: sidecarPath }));
  }
  const readBack = readHandRows({ missing: "empty", path });
  if (readBack.isErr()) {
    return err(LineRetireErrors.registerUnreadable({ cause: readBack.error.message, path }));
  }
  const stillSkipped = new Set(skippedLines({ unparsed: readBack.value.unparsed }));
  const persisting = written.map((row) => row.lineNumber).filter((lineNumber) => stillSkipped.has(lineNumber));
  if (persisting.length > 0) {
    return err(LineRetireErrors.gapPersists({ lineNumbers: persisting }));
  }
  return ok({ plan, sidecarPath, unparsedAfter: readBack.value.unparsed.length, written });
}
