import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { bronzeSourceDir } from "../../../../corpus/corpusPaths.js";
import { readGmailHistoryAnchor, writeGmailHistoryAnchor } from "../../../../corpus/gmail/historyAnchor.js";
import { gmailIngestJob, isEpochWide, readCap } from "../../../../corpus/gmail/ingest.js";
import { gmailIngestNotes } from "../../../../corpus/gmail/ingestNotes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { GmailApi } from "../../../../live/gmail/api.js";
import { GmailErrors } from "../../../../live/gmail/errors.js";
import type { GmailMessage } from "../../../../live/gmail/parse.js";

const WINDOW = { since: "2026-08-01", until: "2026-08-28" };
const NOW = "2026-08-28T06:00:00.000Z";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "gmail-ingest-"));
  fixtureDirs.push(dir);
  return dir;
}

function b64({ text }: { text: string }): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function message({ id }: { id: string }): GmailMessage {
  return {
    id,
    internalDate: "1754042400000",
    labelIds: ["CATEGORY_UPDATES"],
    payload: {
      body: { data: b64({ text: `body ${id}\n\n> quoted tail here` }) },
      headers: [
        { name: "From", value: `Sender ${id} <s-${id}@example.test>` },
        { name: "Subject", value: `subject ${id}` },
      ],
      mimeType: "text/plain",
    },
    threadId: `t-${id}`,
  };
}

/** A plain fake mailbox: one window page, one profile anchor, no history. */
function fakeApi({ ids, next = undefined }: { ids: readonly string[]; next?: string | undefined }): GmailApi {
  const historyId = "5150";
  const notForIngest = async (): Promise<never> => {
    throw new Error("a corpus fetch must never call a mailbox mutation seam");
  };
  return {
    // Every write seam throws rather than answers, and that IS the assertion: a corpus fetch that
    // reached one would fail loudly here instead of quietly changing someone's mailbox. Ingest reads.
    createDraft: notForIngest,
    getAttachment: notForIngest,
    getDraft: notForIngest,
    sendDraft: notForIngest,
    listLabels: notForIngest,
    modifyMessage: notForIngest,
    modifyThread: notForIngest,
    getMessage: async ({ id }) => ok(message({ id })),
    getProfile: async () => ok({ emailAddress: "me@example.test", historyId, messagesTotal: ids.length }),
    getThread: async () => ok([]),
    listHistory: async () => err(GmailErrors.apiFailed({ message: "not used" })),
    listMessageIds: async () =>
      ok({ ids: [...ids], nextPageToken: next, resultSizeEstimate: ids.length, threadIds: [] }),
  };
}

/** Every bronze line written for the gmail source in a home. */
function bronzeLines({ dir }: { dir: string }): readonly string[] {
  const bronze = bronzeSourceDir({ home: dir, source: "gmail" });
  return readdirSync(bronze).flatMap((file) =>
    readFileSync(join(bronze, file), "utf8")
      .split("\n")
      .filter((line) => line.length > 0),
  );
}

describe("isEpochWide", () => {
  it("recognises the epoch floor", () => {
    expect(isEpochWide({ window: { since: "1970-01-01", until: "2026-08-28" } })).toBe(true);
  });

  it("does not mistake an ordinary window for one", () => {
    expect(isEpochWide({ window: WINDOW })).toBe(false);
  });
});

describe("gmailIngestNotes", () => {
  it("names the lane first, since counts alone cannot distinguish a quiet week from an expired anchor", () => {
    const notes = gmailIngestNotes({
      anchored: undefined,
      lane: "delta",
      projected: 3,
      quotedCharsDropped: 0,
      transcriptChars: 0,
      transcripts: 0,
    });
    expect(notes).toStrictEqual(["delta crawl · 3 record(s) projected"]);
  });

  it("reports the strip only when it removed something", () => {
    const notes = gmailIngestNotes({
      anchored: "history anchor advanced to 7",
      lane: "window",
      projected: 1,
      quotedCharsDropped: 42,
      transcriptChars: 0,
      transcripts: 0,
    });
    expect(notes).toStrictEqual([
      "window crawl · 1 record(s) projected",
      "quoted tails and signatures stripped: 42 character(s) not stored",
      "history anchor advanced to 7",
    ]);
  });
});

describe("readCap", () => {
  it("is absent for an unbounded run", () => {
    expect(readCap({ fetchCap: undefined, sample: undefined })).toBeUndefined();
  });

  it("takes --sample when it is the only bound", () => {
    expect(readCap({ fetchCap: undefined, sample: 5 })).toStrictEqual({ maxMessages: 5 });
  });

  it("takes --fetch-cap when it is the only bound", () => {
    expect(readCap({ fetchCap: 7, sample: undefined })).toStrictEqual({ maxMessages: 7 });
  });

  it("takes the TIGHTER of the two, so passing both never widens either", () => {
    expect(readCap({ fetchCap: 7, sample: 3 })).toStrictEqual({ maxMessages: 3 });
    expect(readCap({ fetchCap: 2, sample: 9 })).toStrictEqual({ maxMessages: 2 });
  });
});

describe("gmailIngestJob", () => {
  it("bounds its OWN commit under --sample, which the shell's post-fetch cap cannot reach", async () => {
    const dir = home();
    const job = gmailIngestJob({
      api: fakeApi({ ids: ["a", "b", "c"] }),
      home: dir,
      nowIso: () => NOW,
      sample: 2,
      window: WINDOW,
    });
    const result = unwrap(await job.run());
    expect(result.committedPerContainer).toBe(2);
    expect(bronzeLines({ dir }).length).toBe(2);
  });

  it("HOLDS the anchor for a capped run, so a later full run does not resume past what it skipped", async () => {
    const dir = home();
    const job = gmailIngestJob({
      api: fakeApi({ ids: ["a", "b", "c"] }),
      fetchCap: 1,
      home: dir,
      nowIso: () => NOW,
      window: WINDOW,
    });
    const result = unwrap(await job.run());
    expect(readGmailHistoryAnchor({ home: dir })).toBeUndefined();
    expect(result.notes!.some((note) => note.includes("deliberately capped"))).toBe(true);
  });

  it("commits the records itself and reports them as per-container work", async () => {
    const dir = home();
    const job = gmailIngestJob({ api: fakeApi({ ids: ["a", "b"] }), home: dir, nowIso: () => NOW, window: WINDOW });
    const result = unwrap(await job.run());
    expect(result.committedPerContainer).toBe(2);
    expect(result.projectedPerContainer).toBe(2);
    // Nothing is left for the bulk write: the job committed everything so the anchor below is only ever
    // written after those exact records reached disk.
    expect(result.records).toStrictEqual([]);
    expect(bronzeLines({ dir }).length).toBe(2);
  });

  it("writes private, quoted-stripped, address-scrubbed records", async () => {
    const dir = home();
    const job = gmailIngestJob({ api: fakeApi({ ids: ["a"] }), home: dir, nowIso: () => NOW, window: WINDOW });
    unwrap(await job.run());
    const line: unknown = JSON.parse(bronzeLines({ dir })[0]!);
    const record = line as { text: string; visibility: string; author: string; attrs: Record<string, unknown> };
    expect(record.text).toBe("body a");
    expect(record.visibility).toBe("private");
    expect(record.author).toBe("Sender a");
    expect(record.attrs["from"]).toBe("Sender a <[email]>");
  });

  it("reports the newest committed tsIso, which is the ONLY route the pooled cursor has to move", async () => {
    // This lane commits its own records and hands the bulk write an empty list, so without this field
    // `computeSourceWatermarks` sees nothing for gmail and the pooled watermark never advances at all.
    const job = gmailIngestJob({ api: fakeApi({ ids: ["a", "b"] }), home: home(), nowIso: () => NOW, window: WINDOW });
    const result = unwrap(await job.run());
    expect(result.committedCursor).toBe("2025-08-01T10:00:00.000Z");
  });

  it("advances the anchor to the id read before the crawl", async () => {
    const dir = home();
    const job = gmailIngestJob({ api: fakeApi({ ids: ["a"] }), home: dir, nowIso: () => NOW, window: WINDOW });
    unwrap(await job.run());
    const anchor = readGmailHistoryAnchor({ home: dir })!;
    expect(anchor.historyId).toBe("5150");
    expect(anchor.anchoredAtIso).toBe(NOW);
  });

  it("HOLDS the anchor when the crawl reported a coverage gap, and still keeps what it read", async () => {
    const dir = home();
    const job = gmailIngestJob({
      api: fakeApi({ ids: ["a"], next: "always-more" }),
      home: dir,
      nowIso: () => NOW,
      window: WINDOW,
    });
    const result = unwrap(await job.run());
    expect(result.gaps!.length).toBe(1);
    expect(readGmailHistoryAnchor({ home: dir })).toBeUndefined();
    expect(bronzeLines({ dir }).length).toBeGreaterThan(0);
    expect(result.notes!.some((note) => note.includes("history anchor HELD"))).toBe(true);
  });

  it("warns rather than anchoring when no history id could be established", async () => {
    const dir = home();
    // The profile is overridden rather than parameterised: a defaulted parameter cannot express "absent",
    // which is exactly the state under test.
    const anchorless: GmailApi = {
      ...fakeApi({ ids: ["a"] }),
      getProfile: async () => ok({ emailAddress: "me@example.test", historyId: undefined, messagesTotal: 1 }),
    };
    const job = gmailIngestJob({ api: anchorless, home: dir, nowIso: () => NOW, window: WINDOW });
    const result = unwrap(await job.run());
    expect(readGmailHistoryAnchor({ home: dir })).toBeUndefined();
    expect(result.warnings.some((w) => w.includes("no history anchor could be established"))).toBe(true);
  });

  it("takes the WINDOW lane when an explicit window was named, even with an anchor stored", async () => {
    // An explicit `--since` date was planned, printed in the window line, and then ignored,
    // because the lane branched on the anchor alone. That silently broke `--all --accept-full-history`,
    // which is the documented way to backfill a whole mailbox.
    const dir = home();
    unwrap(writeGmailHistoryAnchor({ fullCrawl: false, historyId: "9903", home: dir, nowIso: NOW }));
    const job = gmailIngestJob({
      api: fakeApi({ ids: ["a"] }),
      cursorOverridden: true,
      home: dir,
      nowIso: () => NOW,
      window: WINDOW,
    });
    const result = unwrap(await job.run());
    expect(result.notes!.some((note) => note.includes("window crawl"))).toBe(true);
    expect(result.committedPerContainer).toBe(1);
  });

  it("takes the DELTA lane when no explicit window was named and an anchor is stored", async () => {
    const dir = home();
    unwrap(writeGmailHistoryAnchor({ fullCrawl: false, historyId: "9903", home: dir, nowIso: NOW }));
    const job = gmailIngestJob({ api: fakeApi({ ids: ["a"] }), home: dir, nowIso: () => NOW, window: WINDOW });
    const result = await job.run();
    // The fake's `listHistory` refuses, which is exactly how this test tells the two lanes apart.
    expect(unwrapErr(result)).toEqual(["not used"]);
  });

  it("declares the source and window it was built for", () => {
    const job = gmailIngestJob({ api: fakeApi({ ids: [] }), home: home(), nowIso: () => NOW, window: WINDOW });
    expect(job.source).toBe("gmail");
    expect(job.window).toStrictEqual(WINDOW);
    expect(job.label).toBe("gmail (mailbox)");
  });

  it("surfaces the crawl failure rather than anchoring on a run that read nothing", async () => {
    const dir = home();
    const broken: GmailApi = {
      ...fakeApi({ ids: [] }),
      listMessageIds: async () => err(GmailErrors.apiFailed({ message: "revoked" })),
    };
    const job = gmailIngestJob({ api: broken, home: dir, nowIso: () => NOW, window: WINDOW });
    const result = await job.run();
    expect(result.isErr()).toBe(true);
    expect(readGmailHistoryAnchor({ home: dir })).toBeUndefined();
  });
});

describe("gmailIngestNotes on a batch carrying meetings", () => {
  it("reports how many transcripts were STORED and how much raw speech they carry", () => {
    const notes = gmailIngestNotes({
      anchored: undefined,
      lane: "window",
      projected: 12,
      quotedCharsDropped: 0,
      transcriptChars: 70_121,
      transcripts: 4,
    });

    expect(notes).toStrictEqual([
      "window crawl · 12 record(s) projected",
      "meeting transcripts: 4 stored, 70121 character(s) of raw speech — a meeting whose document carries " +
        "only Gemini's summary is refused, and says so in the warnings",
    ]);
  });

  it("says nothing about transcripts when the batch had none", () => {
    const notes = gmailIngestNotes({
      anchored: undefined,
      lane: "delta",
      projected: 2,
      quotedCharsDropped: 0,
      transcriptChars: 0,
      transcripts: 0,
    });

    expect(notes.join(" ")).not.toContain("transcript");
  });
});
