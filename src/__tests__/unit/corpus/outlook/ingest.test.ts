/**
 * Unit: the `outlook` mail ingest job over a real temp home. Per folder, not all or nothing: each folder's
 * delta link is written once that folder's round is whole and on disk, a folder that fails holds only its own
 * link, a capped run writes no link at all, and an explicit window reads every folder whole whatever it
 * holds. Every value is synthetic.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, unwrap, unwrapErr } from "#lib/result.js";
import { type OutlookMailClient, outlookMailIngestJob } from "../../../../corpus/outlook/ingest.js";
import { outlookMailSyncAnchorPath, readOutlookMailSyncAnchors } from "../../../../corpus/outlook/syncAnchor.js";
import type { ExportWindow } from "../../../../corpus/types.js";
import type { OutlookApi } from "../../../../live/outlook/apiCore.js";
import { OutlookErrors } from "../../../../live/outlook/errors.js";
import { FAKE_OUTLOOK_ACCOUNT, fakeMailbox, fakeOutlookApi, wireMessage } from "../../../fakeOutlookMailbox.js";
import { linkTo } from "./scriptedDelta.js";

const WINDOW: ExportWindow = { since: "2026-09-01T00:00:00.000Z", until: "2026-10-02T00:00:00.000Z" };
const NOW = "2026-10-02T00:00:00.000Z";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-outlook-mail-ingest-"));
  fixtureDirs.push(dir);
  return dir;
}

/** Two messages in the Inbox and one in the Archive; the fake answers an initial round whole on one page. */
function threeMessageApi(): OutlookApi {
  return fakeOutlookApi({
    mailbox: fakeMailbox({
      messages: [
        wireMessage({ id: "m-1" }),
        wireMessage({ id: "m-2", over: { receivedDateTime: "2026-10-01T10:00:00Z" } }),
        wireMessage({ id: "m-3", over: { parentFolderId: "folder-archive" } }),
      ],
    }),
  });
}

/** One pass of the job. */
async function pass({
  dir,
  api,
  sample,
  cursorOverridden = false,
}: {
  dir: string;
  api: OutlookApi;
  sample?: number;
  cursorOverridden?: boolean;
}): ReturnType<ReturnType<typeof outlookMailIngestJob>["run"]> {
  const client: OutlookMailClient = { account: FAKE_OUTLOOK_ACCOUNT, api };
  return outlookMailIngestJob({
    client,
    cursorOverridden,
    fetchCap: undefined,
    home: dir,
    nowIso: () => NOW,
    sample,
    window: WINDOW,
  }).run();
}

describe("outlookMailIngestJob", () => {
  it("declares itself as the outlook source", () => {
    const job = outlookMailIngestJob({
      client: undefined,
      cursorOverridden: false,
      fetchCap: undefined,
      home: "/h",
      nowIso: () => NOW,
      sample: undefined,
      window: WINDOW,
    });
    expect([job.source, job.label]).toEqual(["outlook", "outlook (mailbox)"]);
  });

  it("commits every message itself, hands the bulk write nothing, and banks the pooled cursor", async () => {
    const outcome = unwrap(await pass({ api: threeMessageApi(), dir: home() }));
    expect(outcome.projectedPerContainer).toBe(3);
    expect(outcome.committedPerContainer).toBe(3);
    expect(outcome.records).toStrictEqual([]);
    expect(outcome.gaps).toEqual([]);
    expect(outcome.committedCursor).toBe("2026-10-01T10:00:00.000Z");
  });

  it("states that a message deleted after it was read keeps its record, on every pass", async () => {
    const outcome = unwrap(await pass({ api: threeMessageApi(), dir: home() }));
    expect(outcome.notes).toContain(
      "0 item(s) removed from or moved out of a folder, counted and never written — a message deleted after it was read keeps its record in the corpus",
    );
  });

  it("writes each folder's link once its round is whole, and the next pass resumes from it", async () => {
    const dir = home();
    const first = unwrap(await pass({ api: threeMessageApi(), dir }));
    expect(first.notes).toContain("delta link advanced for 2 folder(s)");
    expect(unwrap(readOutlookMailSyncAnchors({ home: dir }))).toStrictEqual({
      "folder-archive": { deltaLink: linkTo({ name: "folder-archive" }), recordedAtIso: NOW, version: 1 },
      "folder-inbox": { deltaLink: linkTo({ name: "folder-inbox" }), recordedAtIso: NOW, version: 1 },
    });
    // The fake answers a resumed round with no change, so a resumed pass projects nothing.
    const second = unwrap(await pass({ api: threeMessageApi(), dir }));
    expect(second.projectedPerContainer).toBe(0);
  });

  it("reads every folder whole under an explicit window, whatever links it holds", async () => {
    const dir = home();
    unwrap(await pass({ api: threeMessageApi(), dir }));
    const overridden = unwrap(await pass({ api: threeMessageApi(), cursorOverridden: true, dir }));
    expect(overridden.projectedPerContainer).toBe(3);
    // Bronze already holds every one of them, so nothing new is written.
    expect(overridden.committedPerContainer).toBe(0);
  });

  it("writes no link at all on a capped run, and says what the cap means", async () => {
    const dir = home();
    const outcome = unwrap(await pass({ api: threeMessageApi(), dir, sample: 1 }));
    expect(outcome.projectedPerContainer).toBe(2);
    expect(outcome.notes).toContain(
      "capped at 1 record(s) per folder in Graph's own order, so no delta link was written and nothing here is history or recency",
    );
    expect(unwrap(readOutlookMailSyncAnchors({ home: dir }))).toStrictEqual({});
  });

  it("holds only the failed folder's link, as a gap, while the others advance", async () => {
    const dir = home();
    const healthy = threeMessageApi();
    const api: OutlookApi = {
      ...healthy,
      messageDelta: async (request) => {
        if ("first" in request.start && request.start.first.folderId === "folder-archive") {
          return err(OutlookErrors.apiFailed({ message: "503 unavailable" }));
        }
        return healthy.messageDelta(request);
      },
    };
    const outcome = unwrap(await pass({ api, dir }));
    expect(outcome.gaps!.map((gap) => gap.message)).toEqual([
      "folder folder-archive could not be read whole: 503 unavailable",
    ]);
    expect(Object.keys(unwrap(readOutlookMailSyncAnchors({ home: dir })))).toEqual(["folder-inbox"]);
  });

  it("refuses to read at all when the stored links cannot be trusted", async () => {
    const dir = home();
    const path = outlookMailSyncAnchorPath({ home: dir });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ torn");
    expect(unwrapErr(await pass({ api: threeMessageApi(), dir }))[0]).toContain("are not JSON");
  });
});
