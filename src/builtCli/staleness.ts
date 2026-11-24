/**
 * Whether a built CLI still describes the source it was built from — the pure half of the staleness guard
 * `bin/slopweaver` and the built entrypoint both rest on.
 *
 * ## Why a stamp and not a hash
 *
 * MEASURED over this tree's 4,158 tracked source files: mtime+size costs 178 to 214 ms, a content
 * hash of the same files 861 to 1,712 ms. This check runs on EVERY invocation of a built CLI, so the hash is
 * not affordable and the stamp is. Reproduce with `slopweaver dev build --json` and time the guard.
 *
 * ## Why exact stamps rather than an aggregate
 *
 * A count plus a total size plus the newest mtime is three numbers instead of ~330 KB, and it is nearly
 * always right — which is the problem. The owner's ask was that it be IMPOSSIBLE to test a stale build, and
 * an aggregate silently admits the case where one file grows by exactly what another shed. The per-file
 * comparison has no such case, so it is the one that matches what was asked.
 *
 * The comparison names the FIRST difference in path order rather than counting them: an operator reading a
 * refusal wants one file to look at, and a count is not that.
 */
import { escapeJsonLineBreaks, hasLineBreak } from "#lib/lineBreaks.js";
import { safeJsonParse } from "#lib/safeJson.js";

/** The manifest's filename, inside the built tree. */
export const BUILD_MANIFEST_FILE = ".slopweaver-build.json";

/** One source file as the guard compares it: what it is, when it last changed, and how big it is. */
export interface SourceStamp {
  /** Repo-relative, as `git ls-files` prints it. */
  readonly path: string;
  /** `statSync().mtimeMs`, rounded to the millisecond. */
  readonly mtimeMs: number;
  /** `statSync().size`, in bytes. */
  readonly size: number;
}

/** What a build recorded about the source it emitted, written beside the emitted tree. */
export interface BuildManifest {
  /** When the emit ran. */
  readonly builtAtIso: string;
  /**
   * The repository root the emit read, absolute.
   *
   * RECORDED rather than derived from where the built tree sits, because `--out` takes any directory: a
   * guard that assumed the built tree's parent was the checkout would scan `/tmp` for a build emitted
   * there, find no source at all, and call it fresh.
   */
  readonly root: string;
  /** Every tracked source file the emit read, in `git ls-files` order. */
  readonly stamps: readonly SourceStamp[];
}

/** Whether the built tree still matches the source, and the sentence that says why either way. */
export interface Staleness {
  readonly stale: boolean;
  readonly why: string;
}

/**
 * A source path as a `why` sentence names it. `git ls-files -z` keeps a line break inside a tracked name, and every
 * refusal printing the sentence is one line, so such a name is JSON-quoted with each line break written as an escape:
 * still the exact path, never a second line. Any other name is printed as it is.
 */
function pathInReason({ path }: { path: string }): string {
  if (!hasLineBreak({ text: path })) {
    return path;
  }
  return escapeJsonLineBreaks({ json: JSON.stringify(path) });
}

/**
 * Compare a build's recorded stamps against the source as it stands now.
 *
 * @param manifest what the build recorded
 * @param current the stamps taken just now
 * @returns whether the build is stale, naming the first file that differs, quoted when its name holds a line break
 */
export function stalenessOf({
  manifest,
  current,
}: {
  manifest: BuildManifest;
  current: readonly SourceStamp[];
}): Staleness {
  const recorded = new Map(manifest.stamps.map((stamp) => [stamp.path, stamp]));
  // A Map keeps the last stamp per path, so a repeated path would hide a differing earlier one; a build writes each once.
  if (recorded.size !== manifest.stamps.length) {
    return { stale: true, why: "the build manifest records a source path more than once" };
  }
  for (const stamp of [...current].toSorted((a, b) => a.path.localeCompare(b.path))) {
    const was = recorded.get(stamp.path);
    if (was === undefined) {
      return { stale: true, why: `${pathInReason({ path: stamp.path })} is new since the build` };
    }
    if (was.size !== stamp.size) {
      return {
        stale: true,
        why: `${pathInReason({ path: stamp.path })} is ${String(stamp.size)} bytes, ${String(was.size)} at build time`,
      };
    }
    if (was.mtimeMs !== stamp.mtimeMs) {
      return { stale: true, why: `${pathInReason({ path: stamp.path })} has changed since the build` };
    }
    recorded.delete(stamp.path);
  }
  const gone = [...recorded.keys()].toSorted();
  const first = gone[0];
  if (first !== undefined) {
    return { stale: true, why: `${pathInReason({ path: first })} is gone since the build` };
  }
  return {
    stale: false,
    why: `${String(current.length)} source file(s) unchanged since the build at ${manifest.builtAtIso}`,
  };
}

/**
 * Read a manifest out of its own JSON text, refusing anything that is not one.
 *
 * Every field is checked rather than asserted: the file sits in a directory a build writes and anything
 * else may overwrite, and a guard that trusts its own input is not a guard.
 *
 * @param text the manifest file's contents
 * @returns the manifest, or undefined when the text is not one
 */
export function parseBuildManifest({ text }: { text: string }): BuildManifest | undefined {
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: BUILD_MANIFEST_FILE, text });
  } catch {
    // Text that is not JSON is not a manifest: refused like any other non-manifest, never thrown at the caller.
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const record: Record<string, unknown> = { ...parsed };
  const builtAtIso = record["builtAtIso"];
  const root = record["root"];
  const stamps: unknown = record["stamps"];
  if (typeof builtAtIso !== "string" || typeof root !== "string" || !Array.isArray(stamps)) {
    return undefined;
  }
  const kept: SourceStamp[] = [];
  for (const entry of stamps) {
    if (typeof entry !== "object" || entry === null) {
      return undefined;
    }
    const stamp: Record<string, unknown> = { ...entry };
    const path = stamp["path"];
    const mtimeMs = stamp["mtimeMs"];
    const size = stamp["size"];
    if (typeof path !== "string" || typeof mtimeMs !== "number" || typeof size !== "number") {
      return undefined;
    }
    kept.push({ mtimeMs, path, size });
  }
  return { builtAtIso, root, stamps: kept };
}
