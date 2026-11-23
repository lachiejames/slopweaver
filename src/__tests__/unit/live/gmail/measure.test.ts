/**
 * `gmail measure` — the size, span and byte estimate a full-history backfill is decided on.
 *
 * The seam is a plain object fake over a synthetic mailbox, so the two properties that matter are testable
 * without a Google account: the count is EXACT and comes from the walk, and the byte total is a projection
 * from a spread sample that says so.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { GmailApi } from "../../../../live/gmail/api.js";
import { GmailErrors } from "../../../../live/gmail/errors.js";
import {
  boundedByteSample,
  DEFAULT_BYTE_SAMPLE,
  MAX_BYTE_SAMPLE,
  MEASURE_MAX_PAGES,
  measureGmailMailbox,
  measurementResidue,
  sizeEstimateOf,
  spreadSample,
} from "../../../../live/gmail/measure.js";

const NOW = "2026-08-29T00:00:00.000Z";

/** A fake mailbox of `total` messages, newest first, one per day going backwards from a fixed newest day. */
function fakeMailbox({ total, sizeBytes = 1024 }: { total: number; sizeBytes?: number }): {
  api: GmailApi;
  getCalls: string[];
} {
  const ids = Array.from({ length: total }, (_unused, index) => `id${String(index)}`);
  const getCalls: string[] = [];
  const dayMs = 86_400_000;
  const newest = Date.parse("2026-08-28T00:00:00.000Z");
  const api = {
    getMessage: async ({ id }: { id: string }) => {
      getCalls.push(id);
      const index = ids.indexOf(id);
      return ok({ id, internalDate: String(newest - index * dayMs), sizeEstimate: sizeBytes, threadId: "t" });
    },
    getProfile: async () => ok({ emailAddress: "me@example.test", historyId: "9", messagesTotal: total + 5 }),
    listMessageIds: async ({ pageToken }: { pageToken?: string | undefined }) => {
      const start = pageToken === undefined ? 0 : Number(pageToken);
      const page = ids.slice(start, start + 100);
      const next = start + 100 < ids.length ? String(start + 100) : undefined;
      return ok({ ids: page, nextPageToken: next, resultSizeEstimate: total, threadIds: page.map(() => "t") });
    },
  } as unknown as GmailApi;
  return { api, getCalls };
}

describe("boundedByteSample", () => {
  it("takes the default when the caller named none", () => {
    expect(boundedByteSample({ requested: undefined })).toBe(DEFAULT_BYTE_SAMPLE);
  });

  it("clamps rather than refuses, because every value outside the range still names a coherent intent", () => {
    expect(boundedByteSample({ requested: -4 })).toBe(0);
    expect(boundedByteSample({ requested: 1_000_000 })).toBe(MAX_BYTE_SAMPLE);
    expect(boundedByteSample({ requested: 12.9 })).toBe(12);
  });
});

describe("spreadSample", () => {
  it("strides across the whole list rather than taking the newest N", () => {
    const ids = Array.from({ length: 10 }, (_unused, index) => `id${String(index)}`);
    expect(spreadSample({ ids, sampleSize: 5 })).toEqual(["id0", "id2", "id4", "id6", "id8"]);
  });

  it("returns everything when the sample is at least as large as the list", () => {
    expect(spreadSample({ ids: ["a", "b"], sampleSize: 9 })).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty list or a zero sample", () => {
    expect(spreadSample({ ids: [], sampleSize: 5 })).toEqual([]);
    expect(spreadSample({ ids: ["a"], sampleSize: 0 })).toEqual([]);
  });
});

describe("sizeEstimateOf", () => {
  it("reads Gmail's own figure when it reported one", () => {
    expect(sizeEstimateOf({ message: { sizeEstimate: 4096 } })).toBe(4096);
  });

  it("is undefined when the field is absent, rather than zero", () => {
    expect(sizeEstimateOf({ message: {} })).toBe(undefined);
  });
});

describe("measureGmailMailbox", () => {
  it("counts EXACTLY what the walk enumerated and dates both ends from the walk's own order", async () => {
    const fake = fakeMailbox({ total: 250 });
    const measured = unwrap(
      await measureGmailMailbox({
        account: "me@example.test",
        api: fake.api,
        byteSample: 5,
        nowIso: () => NOW,
        query: undefined,
      }),
    );

    expect(measured.measurement.messagesCounted).toBe(250);
    expect(measured.measurement.listCalls).toBe(3);
    expect(measured.measurement.complete).toBe(true);
    expect(measured.measurement.newestSentAtIso).toBe("2026-08-28T00:00:00.000Z");
    expect(measured.measurement.oldestSentAtIso).toBe("2025-12-22T00:00:00.000Z");
  });

  it("reports Gmail's own total as a SECOND number rather than reconciling it with the count", async () => {
    const fake = fakeMailbox({ total: 10 });
    const measured = unwrap(
      await measureGmailMailbox({
        account: "me@example.test",
        api: fake.api,
        byteSample: 0,
        nowIso: () => NOW,
        query: undefined,
      }),
    );

    expect(measured.measurement.messagesCounted).toBe(10);
    expect(measured.measurement.messagesTotalReported).toBe(15);
    expect(measured.document.coverage.residue.join(" ")).toContain("counts Spam and Trash");
  });

  it("projects bytes from the sample and never reads more than the sample", async () => {
    const fake = fakeMailbox({ sizeBytes: 2048, total: 100 });
    const measured = unwrap(
      await measureGmailMailbox({
        account: "me@example.test",
        api: fake.api,
        byteSample: 4,
        nowIso: () => NOW,
        query: undefined,
      }),
    );

    expect(measured.measurement.bytesSampled).toBe(4);
    expect(measured.measurement.meanMessageBytes).toBe(2048);
    expect(measured.measurement.estimatedBytes).toBe(204_800);
    // 4 sampled, plus the two end-dating reads.
    expect(fake.getCalls.length).toBe(6);
  });

  it("projects no bytes at all when nothing could be sampled, rather than reporting zero", async () => {
    const fake = fakeMailbox({ total: 3 });
    const measured = unwrap(
      await measureGmailMailbox({
        account: "me@example.test",
        api: fake.api,
        byteSample: 0,
        nowIso: () => NOW,
        query: undefined,
      }),
    );

    expect(measured.measurement.estimatedBytes).toBe(undefined);
    expect(measured.document.coverage.residue.join(" ")).toContain("no byte estimate was projected");
  });

  it("measures an empty mailbox without inventing dates", async () => {
    const fake = fakeMailbox({ total: 0 });
    const measured = unwrap(
      await measureGmailMailbox({
        account: "me@example.test",
        api: fake.api,
        byteSample: 5,
        nowIso: () => NOW,
        query: undefined,
      }),
    );

    expect(measured.measurement.messagesCounted).toBe(0);
    expect(measured.measurement.oldestSentAtIso).toBe(undefined);
    expect(measured.measurement.newestSentAtIso).toBe(undefined);
  });

  it("carries the failure when the listing walk cannot start", async () => {
    const failing = {
      getMessage: async () => ok({}),
      getProfile: async () => ok({ emailAddress: "me@example.test", historyId: "1", messagesTotal: 0 }),
      listMessageIds: async () => err(GmailErrors.apiFailed({ message: "gmail refused the listing" })),
    } as unknown as GmailApi;

    const measured = await measureGmailMailbox({
      account: "me@example.test",
      api: failing,
      byteSample: 1,
      nowIso: () => NOW,
      query: undefined,
    });

    expect(unwrapErr(measured).code).toBe("API_FAILED");
    expect(unwrapErr(measured).message).toBe("gmail refused the listing");
  });
});

describe("measurementResidue", () => {
  it("names the count a FLOOR when the walk stopped at its page ceiling", () => {
    const residue = measurementResidue({
      measurement: {
        account: "me@example.test",
        bytesSampled: 1,
        complete: false,
        estimatedBytes: 10,
        listCalls: MEASURE_MAX_PAGES,
        meanMessageBytes: 10,
        messagesCounted: 1,
        messagesTotalReported: undefined,
        newestSentAtIso: undefined,
        oldestSentAtIso: undefined,
        query: undefined,
      },
    });

    expect(residue[0]).toContain("the count is a FLOOR");
  });

  it("always says the read established no content", () => {
    const residue = measurementResidue({
      measurement: {
        account: "me@example.test",
        bytesSampled: 1,
        complete: true,
        estimatedBytes: 10,
        listCalls: 1,
        meanMessageBytes: 10,
        messagesCounted: 1,
        messagesTotalReported: undefined,
        newestSentAtIso: undefined,
        oldestSentAtIso: undefined,
        query: undefined,
      },
    });

    expect(residue.at(-1)).toContain("establishes size and span, never content");
  });
});
