import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentDigest, contentPath } from "../../../../corpus/contentStore.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  livePictureFetch,
  PREVIEW_MAX_BYTES,
  processAlive,
  storePicture,
  sweepAbandonedStaging,
  workspaceHostOf,
} from "../../../../live/slack/channelMedia.js";
import type { DownloadFile } from "../../../../live/slack/download.js";
import { SlackFileDownloadErrors } from "../../../../live/slack/downloadErrors.js";
import { stateHomePaths } from "../../../../stateHome.js";

const BYTES = Buffer.from("\x89PNG\r\n\x1a\n a preview");

let home: string;
let root: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "channel-media-"));
  root = stateHomePaths({ home }).live.slack.channelMedia;
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A download that writes `bytes` where it was told to and records each URL it was asked for. */
function fakeDownload({ asked, bytes }: { asked: string[]; bytes: Buffer }): DownloadFile {
  return async ({ destinationDir, filename, url }) => {
    asked.push(url);
    const localPath = join(destinationDir, filename);
    writeFileSync(localPath, bytes);
    return ok({ bytes: bytes.length, localPath });
  };
}

describe("workspaceHostOf", () => {
  it("reads the lowercase host off an https workspace URL, and nothing off any other", () => {
    expect(
      [
        "https://acme.slack.com/",
        "https://Acme.Enterprise.Slack.com",
        "http://acme.slack.com/",
        "https://acme.example.com/",
        "not a url",
      ].map((url) => workspaceHostOf({ url })),
    ).toEqual(["acme.slack.com", "acme.enterprise.slack.com", undefined, undefined, undefined]);
  });
});

describe("storePicture", () => {
  it("keeps the bytes by their hash, owner-only, and writes no index beside them", () => {
    const sha = unwrap(storePicture({ bytes: BYTES, fileId: "F0ONE", root }));

    expect(sha).toBe(contentDigest({ bytes: BYTES }));
    expect(readFileSync(contentPath({ digest: sha, root }))).toEqual(BYTES);
    expect(statSync(contentPath({ digest: sha, root })).mode & 0o777).toBe(0o600);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(readdirSync(root)).toEqual([sha.slice(0, 2)]);
  });

  it("refuses to write through a symbolic link on the way to the store", () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "channel-media-elsewhere-"));
    mkdirSync(join(home, "live", "slack"), { recursive: true });
    symlinkSync(elsewhere, root);
    const refused = unwrapErr(storePicture({ bytes: BYTES, fileId: "F0ONE", root }));

    expect(refused.code).toBe("PICTURE_UNSTORED");
    expect(refused.message).toContain("is a symbolic link");
    expect(readdirSync(elsewhere)).toEqual([]);
    rmSync(elsewhere, { force: true, recursive: true });
  });
});

describe("sweepAbandonedStaging", () => {
  /** Pid 111 is a killed read; every other pid is still running. */
  const onlyKilled = ({ pid }: { pid: number }): boolean => pid !== 111;

  it("removes the directory of a read whose process is gone, and keeps a running one's however old", () => {
    const staging = join(root, "staging");
    mkdirSync(join(staging, "F0OLD-thumb-480-111-abc"), { recursive: true });
    writeFileSync(join(staging, "F0OLD-thumb-480-111-abc", "F0OLD-thumb-480"), BYTES);
    mkdirSync(join(staging, "F0SLOW-thumb-360-222-def"), { recursive: true });
    const longAgo = new Date(Date.parse("2020-01-01T00:00:00.000Z"));
    utimesSync(join(staging, "F0SLOW-thumb-360-222-def"), longAgo, longAgo);

    expect(sweepAbandonedStaging({ alive: onlyKilled, staging })).toEqual(["F0OLD-thumb-480-111-abc"]);
    expect(readdirSync(staging)).toEqual(["F0SLOW-thumb-360-222-def"]);
  });

  it("never follows or removes a symbolic link, nor a name that carries no pid", () => {
    const staging = join(root, "staging");
    const outside = mkdtempSync(join(tmpdir(), "channel-media-outside-"));
    mkdirSync(join(staging, "not-a-fetch"), { recursive: true });
    symlinkSync(outside, join(staging, "F0LINK-thumb-480-111-ghi"));

    expect(sweepAbandonedStaging({ alive: onlyKilled, staging })).toEqual([]);
    expect(readdirSync(staging).toSorted()).toEqual(["F0LINK-thumb-480-111-ghi", "not-a-fetch"]);
    expect(statSync(outside).isDirectory()).toBe(true);
    rmSync(outside, { force: true, recursive: true });
  });

  it("removes nothing when there is no staging directory yet", () => {
    expect(sweepAbandonedStaging({ alive: onlyKilled, staging: join(root, "staging") })).toEqual([]);
  });
});

describe("processAlive", () => {
  it("says this process is running", () => {
    expect(processAlive({ pid: process.pid })).toBe(true);
  });
});

describe("livePictureFetch", () => {
  it("downloads on every fetch, so a picture already kept is never drawn without Slack answering this token now", async () => {
    const asked: string[] = [];
    const fetch = livePictureFetch({ download: fakeDownload({ asked, bytes: BYTES }), root, token: "xoxp-test" });
    const first = unwrap(await fetch({ fileId: "F0ONE", url: "https://files.slack.com/480", variant: "thumb-480" }));
    const second = unwrap(await fetch({ fileId: "F0ONE", url: "https://files.slack.com/480", variant: "thumb-480" }));

    expect(first).toEqual({ sha256: contentDigest({ bytes: BYTES }) });
    expect(second).toEqual({ sha256: contentDigest({ bytes: BYTES }) });
    expect(asked).toEqual(["https://files.slack.com/480", "https://files.slack.com/480"]);
    // The staging copy is gone once the bytes are kept.
    expect(readdirSync(join(root, "staging"))).toEqual([]);
  });

  it("draws nothing for a file this token can no longer fetch, though its bytes were kept by an earlier read", async () => {
    unwrap(storePicture({ bytes: BYTES, fileId: "F0ONE", root }));
    const revoked: DownloadFile = async ({ url }) => err(SlackFileDownloadErrors.invalidUrl({ url }));
    const fetch = livePictureFetch({ download: revoked, root, token: "xoxb-bot" });
    const refused = unwrapErr(
      await fetch({ fileId: "F0ONE", url: "https://files.slack.com/480", variant: "thumb-480" }),
    );

    expect(refused.code).toBe("PICTURE_UNFETCHED");
    expect(existsSync(contentPath({ digest: contentDigest({ bytes: BYTES }), root }))).toBe(true);
  });

  it("stages two fetches of one preview at once in two directories of their own", async () => {
    const dirs: string[] = [];
    const recording: DownloadFile = async ({ destinationDir, filename }) => {
      dirs.push(destinationDir);
      const localPath = join(destinationDir, filename);
      writeFileSync(localPath, BYTES);
      return ok({ bytes: BYTES.length, localPath });
    };
    const fetch = livePictureFetch({ download: recording, root, token: "xoxp-test" });
    const both = await Promise.all([
      fetch({ fileId: "F0ONE", url: "https://files.slack.com/480", variant: "thumb-480" }),
      fetch({ fileId: "F0ONE", url: "https://files.slack.com/480", variant: "thumb-480" }),
    ]);

    expect(both.map((one) => unwrap(one).sha256)).toEqual([
      contentDigest({ bytes: BYTES }),
      contentDigest({ bytes: BYTES }),
    ]);
    expect(dirs.length).toBe(2);
    expect(new Set(dirs).size).toBe(2);
    expect(readdirSync(join(root, "staging"))).toEqual([]);
  });

  it("asks the download to stop at the preview bound, so the transfer itself is cut off there", async () => {
    const bounds: (number | undefined)[] = [];
    const recording: DownloadFile = async ({ maxBytes }) => {
      bounds.push(maxBytes);
      return err(SlackFileDownloadErrors.tooLarge({ filename: "F0BIG-thumb-480", maxBytes: PREVIEW_MAX_BYTES }));
    };
    const fetch = livePictureFetch({ download: recording, root, token: "xoxp-test" });
    const refused = unwrapErr(
      await fetch({ fileId: "F0BIG", url: "https://files.slack.com/480", variant: "thumb-480" }),
    );

    expect(bounds).toEqual([PREVIEW_MAX_BYTES]);
    expect(refused.code).toBe("PICTURE_UNFETCHED");
    expect(refused.message).toContain("the body ran past 2097152 bytes");
    expect(readdirSync(join(root, "staging"))).toEqual([]);
  });

  it("says the preview did not arrive when the download refuses", async () => {
    const refusing: DownloadFile = async ({ url }) => err(SlackFileDownloadErrors.invalidUrl({ url }));
    const fetch = livePictureFetch({ download: refusing, root, token: "xoxp-test" });
    const refused = unwrapErr(await fetch({ fileId: "F0ONE", url: "not a url", variant: "thumb-480" }));

    expect(refused.code).toBe("PICTURE_UNFETCHED");
    expect(refused.message).toContain("the preview of F0ONE did not arrive");
  });

  it("keeps nothing of a body past the preview bound, and says how big it was", async () => {
    const oversized = Buffer.alloc(PREVIEW_MAX_BYTES + 1);
    const fetch = livePictureFetch({
      download: fakeDownload({ asked: [], bytes: oversized }),
      root,
      token: "xoxp-test",
    });
    const refused = unwrapErr(
      await fetch({ fileId: "F0BIG", url: "https://files.slack.com/480", variant: "thumb-480" }),
    );

    expect(refused.code).toBe("PICTURE_UNFETCHED");
    expect(refused.message).toContain("the preview is 2097153 bytes, past the 2097152 a preview is kept at");
    expect(existsSync(contentPath({ digest: contentDigest({ bytes: oversized }), root }))).toBe(false);
    expect(readdirSync(join(root, "staging"))).toEqual([]);
  });

  it("refuses an id that is not a Slack file id before any download", async () => {
    const asked: string[] = [];
    const fetch = livePictureFetch({
      download: fakeDownload({ asked, bytes: BYTES }),
      root,
      token: "xoxp-test",
    });
    const refused = unwrapErr(
      await fetch({ fileId: "../x", url: "https://files.slack.com/480", variant: "thumb-480" }),
    );

    expect(refused.code).toBe("PICTURE_UNSTORED");
    expect(asked).toEqual([]);
  });
});
