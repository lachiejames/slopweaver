/**
 * The judgement-mining private storage: the pinned brief `route profile-answer` validates against, and the
 * checkpoint marker recording which manifest/prompt contract the currently-accepted profile was mined under
 * (mirrors `src/gold/distilCache.ts`'s prompt-marker pattern — read it before building a new brief to decide
 * whether the source manifest has actually changed, so an unchanged private corpus does not force a re-mine).
 *
 * Both are written with the same owner-only tightening as `../live/turn/judgementProfileStore.ts`, not
 * through the generic `lib/jsonFile.ts` writer: that writer sets no file mode, which is exactly the gap that
 * let a derived-but-still-sensitive file end up world-readable under a normal umask (P3 finding #7).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

import { isRecord } from "../lib/parsers.js";
import { safeFs } from "../lib/safeBoundary.js";
import { stateHomePaths } from "../stateHome.js";
import { sourceManifestSchema } from "./manifestSchema.js";
import { JUDGEMENT_MINING_BRIEF_VERSION, type JudgementMiningBrief } from "./miningBrief.js";

const JUDGEMENT_DIR_MODE = 0o700;
const JUDGEMENT_FILE_MODE = 0o600;

/** Write `value` to `path` under `root` (the judgement directory), tightened to owner-only on every call. */
function writePrivateJson({ root, path, value }: { root: string; path: string; value: unknown }): void {
  mkdirSync(root, { mode: JUDGEMENT_DIR_MODE, recursive: true });
  chmodSync(root, JUDGEMENT_DIR_MODE);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: JUDGEMENT_FILE_MODE });
  chmodSync(path, JUDGEMENT_FILE_MODE);
}

/** Read + parse a JSON file, or undefined when missing/unparseable. */
function readPrivateJson({ path }: { path: string }): unknown {
  if (!existsSync(path)) {
    return undefined;
  }
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "readJudgementPrivateJson", path });
  if (read.isErr()) {
    return undefined;
  }
  try {
    return JSON.parse(read.value);
  } catch {
    return undefined;
  }
}

/** The mining pass's own checkpoint: what it was mined from and when it was accepted. */
export interface JudgementMiningCacheEntry {
  readonly manifestHash: string;
  readonly promptFingerprint: string;
  readonly acceptedAt: string;
}

/** Parse an already-decoded cache value, or undefined if malformed. Pure. */
function parseCacheEntry({ value }: { value: unknown }): JudgementMiningCacheEntry | undefined {
  if (
    !isRecord(value) ||
    typeof value["manifestHash"] !== "string" ||
    typeof value["promptFingerprint"] !== "string" ||
    typeof value["acceptedAt"] !== "string"
  ) {
    return undefined;
  }
  return {
    acceptedAt: value["acceptedAt"],
    manifestHash: value["manifestHash"],
    promptFingerprint: value["promptFingerprint"],
  };
}

/**
 * Read the mining checkpoint, or undefined when none has been accepted yet.
 *
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns the last-accepted mining checkpoint, or undefined
 */
export function readJudgementMiningCache({ home }: { home?: string } = {}): JudgementMiningCacheEntry | undefined {
  const path = stateHomePaths(home === undefined ? {} : { home }).judgement.miningCacheJson;
  return parseCacheEntry({ value: readPrivateJson({ path }) });
}

/**
 * Persist the mining checkpoint, tightening the directory and file to owner-only on every write.
 *
 * @param entry the checkpoint to record
 * @param home the Slopweaver home (defaults to the resolved home)
 */
export function writeJudgementMiningCache({ entry, home }: { entry: JudgementMiningCacheEntry; home?: string }): void {
  const paths = stateHomePaths(home === undefined ? {} : { home });
  writePrivateJson({ path: paths.judgement.miningCacheJson, root: paths.judgement.root, value: entry });
}

/** The envelope every brief version shares — enough to refuse an older one BY NAME rather than as absent. */
const briefEnvelopeSchema = z.object({
  heldOutSourceHashes: z.array(z.string()),
  manifestHash: z.string().min(1),
  prompt: z.object({ system: z.string(), user: z.string() }),
  promptFingerprint: z.string().min(1),
  sourceManifest: z.array(z.unknown()),
  version: z.number().int(),
});

/**
 * Validate an already-decoded brief value, or undefined if malformed. Pure.
 *
 * A current-version brief is parsed WHOLE: one malformed manifest row or held-out hash makes the brief
 * unreadable, never quietly shorter. A brief from another version keeps only its envelope (an empty
 * manifest), so `acceptJudgementMiningAnswer` refuses it on its stale fingerprint instead of reporting that
 * no brief exists.
 */
function parseMiningBrief({ value }: { value: unknown }): JudgementMiningBrief | undefined {
  const envelope = briefEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    return undefined;
  }
  const { heldOutSourceHashes, manifestHash, prompt, promptFingerprint, sourceManifest, version } = envelope.data;
  const base = { heldOutSourceHashes, manifestHash, prompt, promptFingerprint, version };
  if (version !== JUDGEMENT_MINING_BRIEF_VERSION) {
    return { ...base, sourceManifest: [] };
  }
  const manifest = sourceManifestSchema.safeParse(sourceManifest);
  return manifest.success ? { ...base, sourceManifest: manifest.data } : undefined;
}

/**
 * Read the pinned mining brief `route profile-answer` validates a drafted profile against.
 *
 * @param home the Slopweaver home (defaults to the resolved home)
 * @returns the brief, or undefined when none has been written (or it is unparseable)
 */
export function readJudgementMiningBrief({ home }: { home?: string } = {}): JudgementMiningBrief | undefined {
  const path = stateHomePaths(home === undefined ? {} : { home }).judgement.miningBriefJson;
  return parseMiningBrief({ value: readPrivateJson({ path }) });
}

/**
 * Persist a mining brief, tightening the directory and file to owner-only on every write.
 *
 * @param brief the brief to pin
 * @param home the Slopweaver home (defaults to the resolved home)
 */
export function writeJudgementMiningBrief({ brief, home }: { brief: JudgementMiningBrief; home?: string }): void {
  const paths = stateHomePaths(home === undefined ? {} : { home });
  writePrivateJson({ path: paths.judgement.miningBriefJson, root: paths.judgement.root, value: brief });
}
