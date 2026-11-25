/**
 * Unit: one folder's delta round. A round claims its delta link only when Graph returned it on the round's last
 * page and every page committed; a failed page, a failed write or a cap ends the round with no link. A stored
 * link Graph no longer honours restarts the folder from an initial round once, and only once. A tombstone is
 * counted and never written. Over a real temp home and a scripted seam; every value is synthetic.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";
import { createBronzeCommitter } from "../../../../corpus/corpusWriter.js";
import {
  afterPage,
  laterIso,
  nextPageSize,
  readFolderRound,
  restartsOnExpiry,
} from "../../../../corpus/outlook/folderDelta.js";
import type { ExportWindow } from "../../../../corpus/types.js";
import type { OutlookApi, PageStart } from "../../../../live/outlook/apiCore.js";
import { OutlookErrors } from "../../../../live/outlook/errors.js";
import { FAKE_OUTLOOK_ACCOUNT, wireMessage } from "../../../fakeOutlookMailbox.js";
import { type DeltaAnswer, linkTo, scriptedDeltaApi, tombstone } from "./scriptedDelta.js";

const WINDOW: ExportWindow = { since: "2026-09-01T00:00:00.000Z", until: "2026-10-02T00:00:00.000Z" };
const FOLDER = "folder-inbox";
const INITIAL: PageStart<{ readonly folderId: string }> = { first: { folderId: FOLDER } };

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-outlook-round-"));
  fixtureDirs.push(dir);
  return dir;
}

/** A page Graph would answer mid-round. */
function midPage({ ids, next }: { ids: readonly string[]; next: string }): DeltaAnswer {
  return ok({ deltaLink: undefined, items: ids.map((id) => wireMessage({ id })), nextLink: next });
}

/** The last page of a round. */
function lastPage({ items, link }: { items: ReturnType<typeof wireMessage>[]; link: string }): DeltaAnswer {
  return ok({ deltaLink: link, items, nextLink: undefined });
}

/** One round over the scripted seam into a fresh bronze. */
async function round({
  api,
  start = INITIAL,
  cap,
}: {
  api: OutlookApi;
  start?: PageStart<{ readonly folderId: string }>;
  cap?: { maxMessages: number };
}): ReturnType<typeof readFolderRound> {
  return readFolderRound({
    account: FAKE_OUTLOOK_ACCOUNT,
    api,
    cap,
    committer: createBronzeCommitter({ home: home(), window: WINDOW }),
    folderId: FOLDER,
    start,
  });
}

describe("nextPageSize", () => {
  it("asks for a full page when uncapped, what the cap leaves when capped, and never less than one", () => {
    expect(nextPageSize({ cap: undefined, projected: 40 })).toBe(100);
    expect(nextPageSize({ cap: { maxMessages: 5 }, projected: 2 })).toBe(3);
    expect(nextPageSize({ cap: { maxMessages: 5 }, projected: 5 })).toBe(1);
  });
});

describe("laterIso", () => {
  it("answers the later instant, or whichever one is present", () => {
    expect(laterIso({ a: "2026-10-01T00:00:00.000Z", b: "2026-09-01T00:00:00.000Z" })).toBe("2026-10-01T00:00:00.000Z");
    expect(laterIso({ a: "2026-09-01T00:00:00.000Z", b: "2026-10-01T00:00:00.000Z" })).toBe("2026-10-01T00:00:00.000Z");
    expect(laterIso({ a: undefined, b: "2026-10-01T00:00:00.000Z" })).toBe("2026-10-01T00:00:00.000Z");
    expect(laterIso({ a: "2026-10-01T00:00:00.000Z", b: undefined })).toBe("2026-10-01T00:00:00.000Z");
    expect(laterIso({ a: undefined, b: undefined })).toBeUndefined();
  });
});

describe("afterPage", () => {
  it("reads on while Graph has more pages and the cap has room", () => {
    expect(afterPage({ deltaLink: undefined, nextLink: "next", spent: false })).toStrictEqual({ link: "next" });
  });

  it("claims the round's link on its last page", () => {
    expect(afterPage({ deltaLink: "delta", nextLink: undefined, spent: false })).toStrictEqual({
      ending: { deltaLink: "delta" },
    });
  });

  it("claims no link once the cap is spent, even on the round's last page", () => {
    expect(afterPage({ deltaLink: "delta", nextLink: undefined, spent: true })).toStrictEqual({
      ending: { capped: true },
    });
    expect(afterPage({ deltaLink: undefined, nextLink: "next", spent: true })).toStrictEqual({
      ending: { capped: true },
    });
  });
});

describe("restartsOnExpiry", () => {
  const stored: PageStart<{ readonly folderId: string }> = { link: linkTo({ name: "stored" }) };

  it("restarts a stored link Graph dropped the state of, once", () => {
    expect(restartsOnExpiry({ code: "DELTA_STATE_EXPIRED", next: stored, restarted: false })).toBe(true);
    expect(restartsOnExpiry({ code: "DELTA_STATE_EXPIRED", next: stored, restarted: true })).toBe(false);
  });

  it("never restarts an initial round, or on any other failure", () => {
    expect(restartsOnExpiry({ code: "DELTA_STATE_EXPIRED", next: INITIAL, restarted: false })).toBe(false);
    expect(restartsOnExpiry({ code: "API_FAILED", next: stored, restarted: false })).toBe(false);
  });
});

describe("readFolderRound", () => {
  it("commits page by page and claims the link Graph returned on the last page", async () => {
    const { api, asked } = scriptedDeltaApi({
      answers: {
        [linkTo({ name: "p2" })]: [lastPage({ items: [wireMessage({ id: "m-3" })], link: linkTo({ name: "done" }) })],
        "first:folder-inbox": [midPage({ ids: ["m-1", "m-2"], next: linkTo({ name: "p2" }) })],
      },
    });
    const read = await round({ api });
    expect(asked).toEqual(["first:folder-inbox", linkTo({ name: "p2" })]);
    expect(read).toMatchObject({
      capped: false,
      committed: 3,
      deltaLink: linkTo({ name: "done" }),
      failure: undefined,
      projected: 3,
      tombstones: 0,
    });
    expect(read.newestTsIso).toBe("2026-10-01T09:00:00.000Z");
  });

  it("counts a tombstone and never writes it", async () => {
    const { api } = scriptedDeltaApi({
      answers: {
        "first:folder-inbox": [
          ok({
            deltaLink: linkTo({ name: "done" }),
            items: [wireMessage({ id: "m-1" }), tombstone({ id: "gone" })],
            nextLink: undefined,
          }),
        ],
      },
    });
    expect(await round({ api })).toMatchObject({ committed: 1, projected: 1, tombstones: 1 });
  });

  it("restarts a folder whose stored link expired from an initial round, and says so", async () => {
    const stored = linkTo({ name: "stored" });
    const { api, asked } = scriptedDeltaApi({
      answers: {
        [stored]: [err(OutlookErrors.deltaStateExpired({}))],
        "first:folder-inbox": [lastPage({ items: [wireMessage({ id: "m-1" })], link: linkTo({ name: "fresh" }) })],
      },
    });
    const read = await round({ api, start: { link: stored } });
    expect(asked).toEqual([stored, "first:folder-inbox"]);
    expect(read.deltaLink).toBe(linkTo({ name: "fresh" }));
    expect(read.notes).toEqual(["folder folder-inbox: Graph had dropped its delta state, so it was read whole again"]);
  });

  it("restarts only once, and a second expiry ends the round with no link but the pages it committed", async () => {
    const stored = linkTo({ name: "stored" });
    const { api } = scriptedDeltaApi({
      answers: {
        [linkTo({ name: "p2" })]: [err(OutlookErrors.deltaStateExpired({}))],
        [stored]: [err(OutlookErrors.deltaStateExpired({}))],
        "first:folder-inbox": [midPage({ ids: ["m-1"], next: linkTo({ name: "p2" }) })],
      },
    });
    const read = await round({ api, start: { link: stored } });
    expect(read.deltaLink).toBeUndefined();
    expect(read.committed).toBe(1);
    expect(read.failure).toBe(OutlookErrors.deltaStateExpired({}).message);
  });

  it("ends a round whose page failed with no link", async () => {
    const { api } = scriptedDeltaApi({
      answers: { "first:folder-inbox": [err(OutlookErrors.apiFailed({ message: "503 unavailable" }))] },
    });
    expect(await round({ api })).toMatchObject({ committed: 0, deltaLink: undefined, failure: "503 unavailable" });
  });

  it("stops at the cap with no link, keeping exactly the capped records", async () => {
    const { api, asked } = scriptedDeltaApi({
      answers: {
        "first:folder-inbox": [midPage({ ids: ["m-1", "m-2", "m-3"], next: linkTo({ name: "p2" }) })],
      },
    });
    const read = await round({ api, cap: { maxMessages: 2 } });
    expect(asked).toEqual(["first:folder-inbox"]);
    expect(read).toMatchObject({ capped: true, committed: 2, deltaLink: undefined, projected: 2 });
  });
});
