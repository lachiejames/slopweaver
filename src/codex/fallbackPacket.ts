/**
 * The packet a visible Claude session reads for one fallback request — scratch, written OUTSIDE the home.
 *
 * A packet is the diff or the prompt a Codex pass would have read: reproducible from git, read by no gate,
 * and 232 MB across 2,396 requests when they lived in `$SLOPWEAVER_HOME/codex-fallback/` (the measurement is in
 * `../store/schema/codexFallback.ts`). The record is the request and receipt rows (`./fallbackPort.ts`); the
 * packet is only what the preparing session reads next, so it goes to the OS temp directory, which a reboot may
 * clear — the request then stays pending, and a new `prepare` writes a new packet.
 *
 * Each packet gets its own directory minted by `mkdtemp` (`0700`), never a predictable path: a fixed
 * `tmpdir()/slopweaver-fallback/<id>` could be pre-created by another local process. The file is `0600`,
 * because a packet holds a diff of private source.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IngestError } from "#lib/ingestError.js";
import type { Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";
import { writePassDiff } from "./artifactStore.js";

/** File mode: owner read/write only. */
const FILE_MODE = 0o600;

/** Where one packet landed: the file a session reads, and the directory a failed publication removes. */
export interface FallbackPacket {
  readonly packetPath: string;
  readonly scratchDir: string;
}

/** A fresh owner-only directory for one request's packet. */
function mintScratch({ requestId }: { requestId: string }): string {
  // mkdtemp creates the directory 0700 itself.
  return mkdtempSync(join(tmpdir(), `slopweaver-fallback-${requestId}-`));
}

/**
 * Write a REVIEW packet: the diff under review in the same untrusted-material wrapper a Codex pass reads, so
 * the visible session reads exactly what Codex would have.
 *
 * @param requestId the request the packet belongs to, named in its directory
 * @param diff the complete diff text the packet wraps
 * @param property the one property the review answers
 * @returns where it landed, or a typed io error
 */
export function writeReviewPacket({
  diff,
  property,
  requestId,
}: {
  diff: string;
  property: { readonly id: string; readonly statement: string };
  requestId: string;
}): Result<FallbackPacket, IngestError> {
  return safeFs({
    execute: (): FallbackPacket => {
      const scratchDir = mintScratch({ requestId });
      const packet = writePassDiff({ diff, property, scratch: scratchDir });
      if (packet.isErr()) {
        throw new Error(packet.error.message);
      }
      return { packetPath: packet.value, scratchDir };
    },
    operation: "codex.writeReviewPacket",
    path: tmpdir(),
  });
}

/**
 * Write a PLAN packet: the exact planning prompt a Codex pass would have read.
 *
 * @param requestId the request the packet belongs to, named in its directory
 * @param prompt the planning prompt
 * @returns where it landed, or a typed io error
 */
export function writePlanPacket({
  prompt,
  requestId,
}: {
  prompt: string;
  requestId: string;
}): Result<FallbackPacket, IngestError> {
  return safeFs({
    execute: (): FallbackPacket => {
      const scratchDir = mintScratch({ requestId });
      const packetPath = join(scratchDir, "plan-packet.md");
      writeFileSync(packetPath, prompt, { encoding: "utf8", flag: "wx", mode: FILE_MODE });
      return { packetPath, scratchDir };
    },
    operation: "codex.writePlanPacket",
    path: tmpdir(),
  });
}

/**
 * Remove a packet whose request never reached the store, so no packet stands for a request that does not
 * exist. Best effort: a temp directory left behind is scratch, never record.
 *
 * @param packet the packet to remove
 */
export function discardPacket({ packet }: { packet: FallbackPacket }): void {
  rmSync(packet.scratchDir, { force: true, recursive: true });
}
