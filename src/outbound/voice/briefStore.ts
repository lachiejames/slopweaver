/**
 * The effectful edge that assembles one composer briefing: the operator's exact voice rules out of
 * `profile.json`, and their response-shape prose out of the memory that file points at.
 *
 * ## Why this reads through `readProfile`, never `loadProfile`
 *
 * `../../profileStore.ts`'s `loadProfile` answers `undefined` for a corrupt profile as well as an absent one,
 * because its callers want a working emoji over a crashed turn. That conflation is exactly wrong here. A
 * profile nobody can parse would become "no rules configured", and the verb would print a confident brief
 * saying this operator has no voice rules, which is the single worst answer it could give: a composer would
 * then write freely and be refused at the send door by rules it was told did not exist.
 *
 * So this reads `readProfile`, which keeps the two apart. No profile at all is the UNCONFIGURED case and is a
 * success carrying an empty brief — a fresh install has genuinely configured nothing. A profile that exists but
 * cannot be read or parsed, or a configured shape file that is missing or malformed, is a FAILURE, and the verb
 * exits non-zero having printed nothing. "No profile at all" means a genuinely absent file, never "`existsSync`
 * said no": a readable file inside a directory with no execute permission does not exist as far as
 * `existsSync` is concerned. Reproduce the class:
 *   d=$(mktemp -d); mkdir "$d/h"; echo '{}' > "$d/h/profile.json"; chmod 000 "$d/h"
 *   node -e 'console.log(require("fs").existsSync(process.argv[1]))' "$d/h/profile.json"   # false
 *
 * Both files are decoded STRICTLY for the same reason. `readFileSync(path, "utf8")` silently replaces an
 * invalid byte with U+FFFD, so a shape file with one bad byte prints as the operator's guidance with a `�`
 * in the middle of it — a composing session then works from prose the operator did not write, and nothing
 * anywhere says so. A configured source that is not valid UTF-8 is broken configuration, so it takes the
 * same failure path as an unparseable one.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync, statSync } from "node:fs";

import type { IngestError } from "../../lib/ingestError.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { readProfile } from "../../profileStore.js";
import { stateHomePaths } from "../../stateHome.js";
import type { ExactVoiceRule } from "./exactRules.js";
import { parseVoiceShapeMemory } from "./shapeMemory.js";

/** Everything one composer briefing is rendered from — the enforced rules, and the advisory shape. */
export interface VoiceRuleBrief {
  /** The operator's response-shape prose, or `null` when this installation has configured none. */
  readonly shape: string | null;
  /** Whether a single as-me message must put a blank line between its paragraphs. */
  readonly paragraphSpacing: boolean;
  /** The exact deterministic bans the send door enforces. */
  readonly rules: readonly ExactVoiceRule[];
}

/** The brief an installation with no `profile.json` at all gets: nothing configured, and that is not an error. */
const EMPTY_BRIEF: VoiceRuleBrief = { paragraphSpacing: false, rules: [], shape: null };

/**
 * Whether one read of an open file got all of it: as many bytes as it held, and the same size and mtime after as
 * before, so no save ran across the read.
 *
 * @param length how many bytes the read returned
 * @param before the open file's stat taken before the read
 * @param after the same file's stat taken after it
 * @returns true when nothing moved
 */
export function readWasWhole({
  length,
  before,
  after,
}: {
  length: number;
  before: { readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number };
  after: { readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number };
}): boolean {
  return length === before.size && sameStamp({ after, before });
}

/**
 * A file's size, mtime and ctime, or null when nothing is at the path. The ctime is what a replacement cannot set: a
 * rename moves it even when the size and mtime were made to match.
 */
type StatStamp = { readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number } | null;

/**
 * One path's stamp, read without following a failure into a throw: a path that cannot be stated is one the read
 * itself reports, so here it stamps as nothing there.
 *
 * @param path the file to stamp
 * @returns its size and mtime, or null when nothing can be stated there
 */
function statStampOf({ path }: { path: string }): StatStamp {
  try {
    const stat = statSync(path);
    return { ctimeMs: stat.ctimeMs, mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

/**
 * Whether a path's stamp held across a read: absent both times, or one size and one mtime.
 *
 * @param before the stamp taken before the read
 * @param after the stamp taken after it
 * @returns true when nothing moved
 */
export function sameStamp({ before, after }: { before: StatStamp; after: StatStamp }): boolean {
  if (before === null || after === null) {
    return before === after;
  }
  return before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

/**
 * Read one configured file as STRICT UTF-8 — an invalid byte throws instead of becoming U+FFFD.
 *
 * `readFileSync(path, "utf8")` repairs rather than refuses, which for this reader is the worst available
 * behaviour: the operator's own guidance would print with a replacement character substituted into it and
 * nothing would say so. Reproduce the class:
 *   printf 'a\226b' > /tmp/bad.txt
 *   node -e 'console.log(require("fs").readFileSync("/tmp/bad.txt","utf8"))'            # a<U+FFFD>b
 *   node -e 'new TextDecoder("utf-8",{fatal:true}).decode(require("fs").readFileSync("/tmp/bad.txt"))'  # throws
 *
 * @param path the file to read
 * @param operation the boundary label carried into the typed error
 * @returns the decoded text, or the typed boundary error
 */
function readStrictUtf8({ path, operation }: { path: string; operation: string }): Result<string, IngestError> {
  return safeFs({
    // A FIFO or a device would block a synchronous read forever, and every `talk offer` reads this.
    // An in-place save racing the read leaves a valid prefix that would mint as the whole brief, so the
    // read is refused unless the file it opened kept one size and one mtime across it. A save paused half-written
    // for the whole read is a stable file, and no reader can tell it from a short one: the stated residue.
    // Opened non-blocking and judged by the descriptor itself, so a path swapped for a FIFO after any check of the
    // path cannot block the open.
    execute: () => {
      const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const before = fstatSync(fd);
        if (!before.isFile()) {
          throw new Error(`${path} is not a regular file`);
        }
        const bytes = readFileSync(fd);
        const after = fstatSync(fd);
        if (!readWasWhole({ after, before, length: bytes.length })) {
          throw new Error(`${path} changed while it was read, so what was read may be part of it`);
        }
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } finally {
        closeSync(fd);
      }
    },
    operation,
    path,
  });
}

/**
 * Read the operator's exact voice rules ALONE, for a check that judges words rather than briefing a composer —
 * the running list's (`./copyVerdict.ts`). It does not read the shape memory, so a broken shape file cannot stop a
 * rule from being applied; a profile that cannot be read still fails, for the reason this file's header gives.
 *
 * @param home the Slopweaver home holding `profile.json`
 * @returns the exact rules, empty only when no profile exists at all, or why the profile could not be read
 */
export function loadExactVoiceRules({ home }: { home: string }): Result<readonly ExactVoiceRule[]> {
  const profile = readProfile({ home });
  if (profile.isErr()) {
    return err([profile.error.message]);
  }
  if (profile.value === null) {
    return ok(EMPTY_BRIEF.rules);
  }
  return ok(profile.value.slackMe.voice.exact);
}

/**
 * Read the operator's voice configuration and, when one is configured, the response-shape memory it points at.
 *
 * @param home the Slopweaver home holding `profile.json`
 * @returns the assembled briefing, or every reason the configured state could not be read
 */
export function loadVoiceRuleBrief({ home }: { home: string }): Result<VoiceRuleBrief> {
  // The same race as the shape file's: a profile rewritten in place across the read could parse as one with no rules
  // and mint as "none configured", so the read stands only when the file kept one stamp across it.
  const profilePath = stateHomePaths({ home }).profileJson;
  const stampBefore = statStampOf({ path: profilePath });
  const profile = readProfile({ home });
  if (profile.isErr()) {
    return err([profile.error.message]);
  }
  if (!sameStamp({ after: statStampOf({ path: profilePath }), before: stampBefore })) {
    return err([`${profilePath} changed while it was read, so what was read may be part of it`]);
  }
  if (profile.value === null) {
    return ok(EMPTY_BRIEF);
  }
  // `slackMe` and `slackMe.voice` are both prefaulted by the schema, so a valid profile always has a voice
  // block — an install that configured nothing reaches here with an empty `exact` and no `shapeMemoryFile`,
  // which is a legitimate brief rather than an absence to guard against.
  const { voice } = profile.value.slackMe;
  const base = { paragraphSpacing: voice.paragraphSpacing, rules: voice.exact };
  const shapeFile = voice.shapeMemoryFile;
  if (shapeFile === undefined) {
    return ok({ ...base, shape: null });
  }
  const shapeRead = readStrictUtf8({ operation: "readVoiceShapeMemory", path: shapeFile });
  if (shapeRead.isErr()) {
    return err([`${shapeFile}: ${shapeRead.error.message}`]);
  }
  const shape = parseVoiceShapeMemory({ file: shapeFile, text: shapeRead.value });
  return shape.isErr() ? err(shape.error) : ok({ ...base, shape: shape.value });
}
