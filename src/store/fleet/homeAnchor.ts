/**
 * Reading an anchor that cites a file under the state home as the path a location table is keyed by. Pure,
 * but for the realpath lookup an absolute spelling needs.
 *
 * Anchors in canon are written every way a session has ever typed a path —
 * `~/.slopweaver/evidence/token-usage-audit-03sep.md`, `$SLOPWEAVER_HOME/proof/…png`, a `state:` token, a
 * `file:` URL, an absolute path, a path already relative to the home, each perhaps with a `#fragment`. Every
 * one resolves to the same question: which path under the home. Two readers share that answer — owner turns
 * (`./ownerTurnAnchor.ts`) and measurements (`./measurementAnchor.ts`) — so the two cannot disagree about
 * which spelling names which file.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, sep } from "node:path";

import { STATE_BRIEF_PREFIX } from "../../handover/briefPaths.js";

/** Spellings of the home a written anchor opens with, each followed by a home-relative path. */
const HOME_PREFIXES: readonly string[] = ["~/.slopweaver/", "$SLOPWEAVER_HOME/"];

/** A scheme this resolver does not read — `transcript:`, `artifact:` and the like cite no file. */
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:/u;

/**
 * The anchor with its fragment dropped and a `state:` or `file:` scheme removed.
 *
 * A fragment is the anchor's own sub-pointer into the text, never part of the file's name.
 *
 * @param ref the anchor as typed
 * @returns the path or label it carries, or `undefined` when it carries a scheme that names no file
 */
export function anchorToken({ ref }: { ref: string }): string | undefined {
  const [withoutFragment] = ref.trim().split("#");
  const token = withoutFragment!;
  if (token.startsWith(STATE_BRIEF_PREFIX)) {
    return token.slice(STATE_BRIEF_PREFIX.length);
  }
  if (token.startsWith("file://")) {
    return token.slice("file://".length);
  }
  if (token.startsWith("file:")) {
    return token.slice("file:".length);
  }
  if (OTHER_SCHEME.test(token)) {
    return undefined;
  }
  return token;
}

/**
 * A path token as a normalised path under the home.
 *
 * @param home the state home
 * @param token an absolute path, a home-prefixed path, or a path already relative to the home
 * @returns the `/`-separated path under the home, or `undefined` when it leaves the home
 */
export function homeRelativeOfToken({ home, token }: { home: string; token: string }): string | undefined {
  const prefix = HOME_PREFIXES.find((candidate) => token.startsWith(candidate));
  let candidate: string;
  if (prefix !== undefined) {
    candidate = token.slice(prefix.length);
  } else if (isAbsolute(token)) {
    const under = absoluteUnderHome({ home, token });
    if (under === undefined) {
      return undefined;
    }
    candidate = under;
  } else {
    candidate = token;
  }
  const normalised = posix.normalize(candidate);
  if (normalised === ".." || normalised.startsWith("../") || normalised.startsWith("/")) {
    return undefined;
  }
  return normalised;
}

/**
 * An absolute path as a path under the home, comparing real paths as well as the spellings given.
 *
 * The anchored FILE is usually gone — that is the case this resolver exists for — so the token cannot be
 * resolved whole; its nearest EXISTING ancestor is, and the missing tail is carried over as written. On
 * macOS `/tmp` and `/var` are links into `/private`, and an anchor written through one spelling of a home
 * named by the other refused as "outside the home" unless both spellings are resolved.
 *
 * @param home the state home
 * @param token an absolute path
 * @returns the `/`-separated path under the home, or `undefined` when it is under neither spelling
 */
function absoluteUnderHome({ home, token }: { home: string; token: string }): string | undefined {
  const homes = [home, ...realOf({ path: home })];
  const tokens = [token, ...realOf({ path: token })];
  for (const root of homes) {
    for (const spelled of tokens) {
      const under = relative(root, spelled).split(sep).join("/");
      if (!isAbsolute(under) && under !== ".." && !under.startsWith("../")) {
        return under;
      }
    }
  }
  return undefined;
}

/**
 * A path's real spelling: its nearest existing ancestor resolved through every link, the rest as written.
 *
 * @param path an absolute path, which need not exist
 * @returns the real spelling, or nothing when no ancestor resolves
 */
function realOf({ path }: { path: string }): readonly string[] {
  const tail: string[] = [];
  let current = path;
  for (;;) {
    try {
      return [join(realpathSync(current), ...tail.toReversed())];
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return [];
      }
      tail.push(basename(current));
      current = parent;
    }
  }
}
