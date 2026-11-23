/*
 * A real checkout on branch `feature` and Claude fallback receipts recorded on it, written through the same port
 * `review-fallback record` uses over an in-memory store. Shared by the review verbs' pre-spend reads
 * (`reviewAnnounce.test.ts`, `reviewCapGate.test.ts`), which fold exactly what this writes.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FallbackRegisterPort } from "../../../../../codex/fallbackPort.js";
import { fallbackReceiptText, fallbackRequestText } from "../../../../../codex/fallbackRequestRead.js";
import { validateFallbackReview } from "../../../../../codex/fallbackReview.js";
import { captureTreeFingerprint, resolveRepoRoot } from "../../../../../codex/gitDiff.js";
import { unwrap } from "../../../../../lib/result.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

/** Every directory {@link scratch} minted, for the caller's `afterEach` to hand to {@link removeScratch}. */
const minted: string[] = [];

/**
 * A throwaway directory under the per-file temp sandbox.
 *
 * @param label a word naming what the directory holds, so a leaked one says what it was
 * @returns the directory's absolute path
 */
export function scratch({ label }: { label: string }): string {
  const dir = mkdtempSync(join(tmpdir(), `slopweaver-fallback-${label}-`));
  minted.push(dir);
  return dir;
}

/** Remove every directory {@link scratch} minted since the last call. */
export function removeScratch(): void {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * A one-commit checkout on branch `feature`.
 *
 * @returns the checkout's directory
 */
export function scratchRepo(): string {
  const dir = scratch({ label: "repo" });
  for (const args of [
    ["init", "--initial-branch=feature"],
    ["config", "user.email", "dev@example.invalid"],
    ["config", "user.name", "Dev"],
  ]) {
    gitInTemp({ args, cwd: dir });
  }
  writeFileSync(join(dir, "a.txt"), "one\n");
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-m", "first"], cwd: dir });
  return dir;
}

/**
 * The diff digest a receipt recorded at `minute` carries — one distinct diff per minute, so one review pass each.
 *
 * @returns a 64-character digest ending in the minute
 */
export function diffAtMinute({ minute }: { minute: number }): string {
  return String(minute).padStart(64, "d");
}

/**
 * One recorded Claude fallback review of `propertyId` on this checkout, answered `verdict`.
 *
 * @param dir the checkout the review read
 * @param minute when it was recorded, which also picks its diff ({@link diffAtMinute})
 * @param port the in-memory register it is written through
 */
export async function recordFallback({
  dir,
  home,
  minute,
  port,
  propertyId,
  verdict,
}: {
  dir: string;
  home: string;
  minute: number;
  port: FallbackRegisterPort;
  propertyId: string;
  verdict: "BROKEN" | "CLEAN";
}): Promise<void> {
  const now = unwrap(captureTreeFingerprint({ cwd: dir }));
  const at = `2026-09-24T12:${String(minute).padStart(2, "0")}`;
  const request = {
    baseRef: "origin/main",
    baseSha: now.headSha,
    capEvidence: { blockedBy: "capped", limitId: "premium", observedAtIso: `${at}:00.000Z`, reachedType: null },
    createdAtIso: `${at}:00.000Z`,
    diffBytes: 1,
    diffSha256: diffAtMinute({ minute }),
    headSha: now.headSha,
    pass: "r3",
    property: { id: propertyId, statement: "s" },
    repoRoot: unwrap(resolveRepoRoot({ cwd: dir })),
    requestId: `req-${propertyId}-${String(minute)}`,
    schemaVersion: 1,
    tree: { branch: "feature", dirtyBytes: 0, fingerprint: now.digest, headSha: now.headSha, treeSha: now.treeSha },
  } as const;
  const requestText = fallbackRequestText({ request });
  unwrap(await port.writeRequest({ home, requestId: request.requestId, requestText }));
  const receipt = unwrap(
    validateFallbackReview({
      answer: JSON.stringify({
        counterexample: verdict === "BROKEN" ? "a reachable state" : "",
        evidence: "e",
        propertyId,
        summary: "s",
        verdict,
      }),
      completedAtIso: `${at}:30.000Z`,
      now,
      receiptId: `rcpt-${propertyId}-${String(minute)}`,
      request,
      requestBytes: requestText,
      reviewer: { host: "claude-code", model: null, workspace: null },
    }),
  );
  unwrap(
    await port.writeReceipt({ home, receiptText: fallbackReceiptText({ receipt }), requestId: request.requestId }),
  );
}
