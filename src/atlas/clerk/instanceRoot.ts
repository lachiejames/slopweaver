/**
 * The instance root this atlas has learned, remembered in PRIVATE state so a walk never depends on where
 * the owner's browser was last pointed.
 *
 * ## Why a remembered root exists at all
 *
 * MEASURED across real walks of the owner's dashboard. The Clerk dashboard sends the bare origin to whatever
 * page it last showed, so the origin probe answers `/apps/<application>/instances/<instance>` for a session
 * that was last on an instance and `/apps` for one that was last on the application list — and in the second
 * state the declared pages hanging off the instance root were recorded as having no root to hang off. The application list is
 * SERVER-RENDERED: its own traffic carries neither identifier in a URL and neither in a JSON body, so the
 * traffic fallback cannot recover one there either. A walk whose denominator depends on browsing history is
 * not a walk, so the root is learned once and kept.
 *
 * ## It lives under the state home because it is CONTENT, not shape
 *
 * An application id and an instance id identify the organisation's own Clerk application, which is a private
 * identifier this repository may not carry — `docs/constraints/partition.md`'s partition applied exactly: the plugin
 * owns the shape, and the private state home owns the content. So the file is written `0600` under the
 * atlas's own directory, never committed, and no verb prints it.
 *
 * ## A remembered root is the LAST resort, never the first
 *
 * The order in `browserWalk.ts` is landing URL, then traffic, then this. A remembered root is by
 * construction the least fresh of the three — the instance it names may have been deleted — so a page that
 * fails against it fails with the ordinary unreachable reason, and the next probe that succeeds overwrites
 * it. The file records when it was learned so a reader can see how old the fallback is.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";

import { type ClerkAtlasError, ClerkAtlasErrors, clerkAtlasErrorLines } from "./errors.js";

/** The shape a root must have before it is written or believed. */
const ROOT_SHAPE = /^\/apps\/[A-Za-z0-9_-]+\/instances\/[A-Za-z0-9_-]+$/;

/**
 * Where the remembered root lives, inside the atlas's own directory.
 *
 * @param directory the atlas's generation directory
 * @returns the absolute path
 *
 * @internal
 */
export function clerkInstanceRootPath({ directory }: { directory: string }): string {
  return join(directory, "instance-root.json");
}

/**
 * Whether a string is a well-formed instance root.
 *
 * Checked on both the read and the write side, so a hand-edited file and a bad `--root` are refused by the
 * same rule — and so nothing that is not a path can ever be interpolated into a URL the walk visits.
 *
 * @param root the candidate root
 * @returns whether it has the shape `/apps/<application>/instances/<instance>`
 */
export function isClerkInstanceRoot({ root }: { root: string }): boolean {
  return ROOT_SHAPE.test(root);
}

/**
 * Whether a caught read error means the file simply is not there: `ENOENT` AND no directory entry at the path. A
 * dangling symlink also reads `ENOENT`, but something IS there, so it is unreadable rather than absent.
 */
function isMissingFile({ error, path }: { error: unknown; path: string }): boolean {
  const notFound = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
  if (!notFound) {
    return false;
  }
  try {
    lstatSync(path);
    return false;
  } catch {
    return true;
  }
}

/**
 * The well-formed root a remembered-root file's parsed contents hold, or why they cannot be believed. The
 * reason never quotes what it found: a well-formed root names the organisation's own application.
 */
function rememberedRootIn({ parsed }: { parsed: unknown }): Result<string, string> {
  if (!isRecord(parsed)) {
    return err("it is not a JSON object");
  }
  const root = parsed["root"];
  if (typeof root !== "string") {
    return err("it carries no root string");
  }
  if (!isClerkInstanceRoot({ root })) {
    return err("its root does not read /apps/<application>/instances/<instance>");
  }
  return ok(root);
}

/** The typed refusal for a remembered-root file that is there but cannot be believed. */
function unreadable({ detail, path }: { detail: string; path: string }): Result<string | null, ClerkAtlasError> {
  return err(ClerkAtlasErrors.rememberedRootUnreadable({ detail, path }));
}

/**
 * Read the remembered root, when one has been learned.
 *
 * No file is the ordinary state of an install that has never walked, so it answers `null` and the walk's two
 * live probes stand alone. A file that IS there but cannot be read, is not JSON, or does not hold a
 * well-formed root is a different fact — something wrote it wrong or it was edited by hand — so it is refused
 * with `CLERK_REMEMBERED_ROOT_UNREADABLE` rather than read as nothing, and the corruption is said out loud
 * instead of the walk quietly losing its last probe. `--root` overwrites the file before this read, which is
 * the refusal's own way out.
 *
 * @param directory the atlas's generation directory
 * @returns the remembered root, `null` when no file has ever been written, or the typed
 *   `CLERK_REMEMBERED_ROOT_UNREADABLE` saying why the file there is untrustworthy — rendered at the verb, not here
 */
export function readClerkInstanceRoot({ directory }: { directory: string }): Result<string | null, ClerkAtlasError> {
  const path = clerkInstanceRootPath({ directory });
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (isMissingFile({ error, path })) {
      return ok(null);
    }
    return unreadable({ detail: errorMessage({ error }), path });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return unreadable({ detail: "it is not JSON", path });
  }
  const root = rememberedRootIn({ parsed });
  if (root.isErr()) {
    return unreadable({ detail: root.error, path });
  }
  return ok(root.value);
}

/**
 * Remember one instance root, replacing whatever was there.
 *
 * @param directory the atlas's generation directory
 * @param root the root a probe resolved
 * @param at this run's ISO timestamp, so a reader can see how old the fallback is
 * @returns nothing when it was written, or why it could not be
 */
export function writeClerkInstanceRoot({
  directory,
  root,
  at,
}: {
  directory: string;
  root: string;
  at: string;
}): Result<null> {
  if (!isClerkInstanceRoot({ root })) {
    return err(clerkAtlasErrorLines({ error: ClerkAtlasErrors.rootMalformed({ root }) }));
  }
  try {
    writeFileAtomic({
      contents: `${JSON.stringify({ learnedAt: at, root }, null, 1)}\n`,
      fileMode: 0o600,
      path: clerkInstanceRootPath({ directory }),
    });
    return ok(null);
  } catch (cause: unknown) {
    return err(clerkAtlasErrorLines({ error: ClerkAtlasErrors.rootUnremembered({ cause }) }));
  }
}
