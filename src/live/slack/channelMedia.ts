/**
 * The pictures behind the console's live channel window — Slack's own preview renditions, fetched by every read and
 * kept, content-addressed, at `$SLOPWEAVER_HOME/live/slack/channel-media/<sha[0:2]>/<sha256>`.
 *
 * Hovering a channel on the Workstreams page opens what Slack desktop would show, IMAGES INCLUDED, so the owner
 * never leaves localhost. Slack desktop draws a posted picture as its preview, so this keeps the
 * preview (`thumb_480`, else `thumb_360`) and never the original — a screenshot's preview is tens of kilobytes where
 * the original can be megabytes, and a hover reads a whole page of them.
 *
 * The bytes come through `./download.ts`, the ONE authenticated Slack GET (its host allowlist, its token-stripping
 * redirect walk, its HTML-200 refusal), into a staging file, and are then stored by their hash —
 * `../../corpus/contentStore.ts`'s naming and sharding. The console serves a blob only after re-hashing it
 * (`site/lib/draftMediaServe.ts`).
 *
 * There is no index and no cache hit: a read never draws a picture it did not itself download, on its own token,
 * just now. A held preview would be drawn on the strength of the listing alone, and the listing is not the bytes'
 * authority — a bot read would draw what a user read kept, and a file whose access was revoked after it was kept
 * would still draw. The store only names what was fetched so the console can serve it.
 *
 * Directories `0700`, files `0600`, and a symbolic link anywhere between the home and a write is refused: these are
 * unredacted pictures out of the owner's Slack, exactly as private as `read-thread`'s thread files.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { firstLinkedEntry } from "#lib/pathContainment.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomicBytes } from "#lib/writeAtomic.js";
import { contentDigest, contentPath } from "../../corpus/contentStore.js";
import { type ChannelViewError, ChannelViewErrors } from "./channelViewErrors.js";
import type { DownloadFile } from "./download.js";

/** Owner-only permissions: these are pictures out of the owner's Slack. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The most a kept preview may weigh. A `thumb_480` is tens of kilobytes, so this is twenty times the largest one
 * expected rather than a measured ceiling; a bigger body is not what Slack's preview is, so its transfer is cancelled
 * at the bound and nothing of it is kept. How long a transfer may take is the
 * route's 45s kill.
 */
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

/** Which of Slack's renditions a fetched picture is. */
export type PictureVariant = "thumb-480" | "thumb-360";

/** A Slack file id, as Slack mints one — the only shape that becomes part of a staging directory's name. */
const FILE_ID = /^F[A-Z0-9]+$/u;

/** A Slack workspace host, lowercase, as `auth.test` and an `/archives/` link spell it; no label can be `..`. */
const WORKSPACE_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.slack\.com$/u;

/**
 * Whether `host` is a Slack workspace host such as `acme.slack.com`, the only shape that becomes part of a path or
 * reaches the verb's workspace check.
 *
 * @returns true for a lowercase `*.slack.com` host
 */
export function isWorkspaceHost({ host }: { host: string }): boolean {
  return WORKSPACE_HOST.test(host);
}

/**
 * The workspace host an `https://` workspace URL names, the shape `auth.test` answers with.
 *
 * @returns the lowercase host, or `undefined` when the URL is not a Slack workspace's
 */
export function workspaceHostOf({ url }: { url: string }): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.host.toLowerCase();
  if (parsed.protocol !== "https:" || !isWorkspaceHost({ host })) {
    return undefined;
  }
  return host;
}

/**
 * One fetched preview: the hash its bytes are stored under.
 *
 * @internal — what {@link FetchPicture} answers; nothing names it on its own.
 */
export interface FetchedPicture {
  readonly sha256: string;
}

/** The seam the channel window fetches a preview through — the live one below, or a test's plain fake. */
export type FetchPicture = (args: {
  fileId: string;
  url: string;
  variant: PictureVariant;
}) => Promise<Result<FetchedPicture, ChannelViewError>>;

/** The first entry between the home and `path` that is a symbolic link, or `undefined` when none is. */
function linkedEntry({ root, path }: { root: string; path: string }): string | undefined {
  // `root` is `<home>/live/slack/channel-media`, so three levels up is the home exactly as `stateHome.ts` spells it.
  return firstLinkedEntry({ path, top: dirname(dirname(dirname(root))) });
}

/**
 * Keep one preview's bytes by their hash, so the console can serve exactly them.
 *
 * Idempotent: the same bytes land at the same name. The modes are settled after the write rather than trusted from
 * it, since a recursive create never changes a directory it finds and the umask can narrow what it asks for.
 *
 * @param root the channel-media store, `stateHomePaths().live.slack.channelMedia`
 * @param fileId the Slack file the bytes are a preview of, named in a refusal
 * @param bytes the preview exactly as it arrived
 * @returns the bytes' hash, or why they could not be kept
 */
export function storePicture({
  root,
  fileId,
  bytes,
}: {
  root: string;
  fileId: string;
  bytes: Buffer;
}): Result<string, ChannelViewError> {
  const sha256 = contentDigest({ bytes });
  const blob = contentPath({ digest: sha256, root });
  const linked = linkedEntry({ path: blob, root });
  if (linked !== undefined) {
    return err(ChannelViewErrors.pictureUnstored({ fileId, why: `${linked} is a symbolic link` }));
  }
  try {
    if (!existsSync(blob)) {
      writeFileAtomicBytes({ bytes, dirMode: DIR_MODE, fileMode: FILE_MODE, path: blob });
    }
    for (const directory of [root, dirname(blob)]) {
      chmodSync(directory, DIR_MODE);
    }
    chmodSync(blob, FILE_MODE);
  } catch (cause: unknown) {
    return err(ChannelViewErrors.pictureUnstored({ fileId, why: errorMessage({ error: cause }) }));
  }
  return ok(sha256);
}

/**
 * A per-fetch staging directory's name: the preview it holds, then the pid of the process fetching it, then
 * `mkdtempSync`'s suffix. The pid is the ownership a later sweep reads: a directory is abandoned exactly when the
 * process that made it is gone, which is what the console route's `SIGKILL` leaves, since it skips the fetch's own
 * `finally`. Age is no test of that: a slow read is still running however old its directory is.
 */
const STAGING_DIR = /^F[A-Z0-9]+-thumb-(?:480|360)-(\d+)-/u;

/** Whether a process is still running, injected so a test names the living and the dead. */
export type ProcessAlive = (args: { pid: number }) => boolean;

/**
 * Whether `pid` is a running process: signal 0 checks without sending anything, and `EPERM` means it exists but
 * belongs to someone else.
 *
 * @returns true unless the system says no such process exists
 */
export const processAlive: ProcessAlive = ({ pid }) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause: unknown) {
    return !(cause instanceof Error && "code" in cause && cause.code === "ESRCH");
  }
};

/**
 * Remove every per-fetch staging directory whose fetching process is gone. A directory of a living process, one
 * whose name carries no pid, and a symbolic link are all left alone, and an entry that cannot be read or removed is
 * left for the next fetch: the sweep only ever shrinks what a killed read left, so it never fails a picture.
 *
 * @param staging the channel-media store's `staging` directory
 * @param alive whether the process a directory names is still running
 * @returns the names it removed
 */
export function sweepAbandonedStaging({ staging, alive }: { staging: string; alive: ProcessAlive }): readonly string[] {
  const removed: string[] = [];
  let names: readonly string[];
  try {
    names = readdirSync(staging);
  } catch {
    return removed;
  }
  for (const name of names) {
    const owner = STAGING_DIR.exec(name)?.[1];
    if (owner === undefined || alive({ pid: Number(owner) })) {
      continue;
    }
    const path = join(staging, name);
    try {
      const entry = lstatSync(path);
      if (entry.isDirectory()) {
        rmSync(path, { force: true, recursive: true });
        removed.push(name);
      }
    } catch {
      // Gone already, or not ours to remove: the next fetch looks again.
    }
  }
  return removed;
}

/**
 * The live preview fetch: one download through `./download.ts`, on the token the channel was just read under, into a
 * staging file that is stored by its hash and then removed. Every call downloads; Slack answering this token for
 * these bytes now is the only authority a drawn picture has.
 *
 * @param root the channel-media store
 * @param token the Slack token the channel was read under, which is authorised for its files
 * @param download the one authenticated Slack byte GET
 * @returns the fetch the channel window takes
 */
export function livePictureFetch({
  root,
  token,
  download,
}: {
  root: string;
  token: string;
  download: DownloadFile;
}): FetchPicture {
  return async ({ fileId, url, variant }) => {
    if (!FILE_ID.test(fileId)) {
      return err(ChannelViewErrors.pictureUnstored({ fileId, why: "it is not a Slack file id" }));
    }
    const staging = join(root, "staging");
    const linked = linkedEntry({ path: staging, root });
    if (linked !== undefined) {
      return err(ChannelViewErrors.pictureUnstored({ fileId, why: `${linked} is a symbolic link` }));
    }
    // A directory of its own per download, so two reads of one channel at once never write the same staging file
    // `mkdtempSync` makes it `0700`.
    let own: string;
    try {
      mkdirSync(staging, { mode: DIR_MODE, recursive: true });
      sweepAbandonedStaging({ alive: processAlive, staging });
      own = mkdtempSync(join(staging, `${fileId}-${variant}-${String(process.pid)}-`));
    } catch (cause: unknown) {
      return err(ChannelViewErrors.pictureUnstored({ fileId, why: errorMessage({ error: cause }) }));
    }
    try {
      return await stagedPicture({ download, fileId, own, root, token, url, variant });
    } finally {
      rmSync(own, { force: true, recursive: true });
    }
  };
}

/**
 * One preview downloaded into its own staging directory, then stored by its hash. The caller owns the directory and
 * removes it however this ends.
 */
async function stagedPicture({
  download,
  fileId,
  own,
  root,
  token,
  url,
  variant,
}: {
  download: DownloadFile;
  fileId: string;
  own: string;
  root: string;
  token: string;
  url: string;
  variant: PictureVariant;
}): ReturnType<FetchPicture> {
  // Slack's `size` is the ORIGINAL's, so a preview is never held to it; `maxBytes` cancels the transfer itself
  // past the bound, so an oversized body never lands whole even in staging.
  const downloaded = await download({
    destinationDir: own,
    expectedBytes: undefined,
    filename: `${fileId}-${variant}`,
    maxBytes: PREVIEW_MAX_BYTES,
    token,
    url,
  });
  if (downloaded.isErr()) {
    return err(ChannelViewErrors.pictureUnfetched({ cause: downloaded.error.message, fileId }));
  }
  if (downloaded.value.bytes > PREVIEW_MAX_BYTES) {
    return err(
      ChannelViewErrors.pictureUnfetched({
        cause: `the preview is ${String(downloaded.value.bytes)} bytes, past the ${String(PREVIEW_MAX_BYTES)} a preview is kept at`,
        fileId,
      }),
    );
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(downloaded.value.localPath);
  } catch (cause: unknown) {
    return err(ChannelViewErrors.pictureUnstored({ fileId, why: errorMessage({ error: cause }) }));
  }
  return storePicture({ bytes, fileId, root }).map((sha256) => ({ sha256 }));
}
