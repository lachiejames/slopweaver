/**
 * The `fathom` ingest job: `readCap` collapses `--sample` and `--fetch-cap` to the tighter of the two, and the
 * job descriptor carries its label, source and window. Running the job with an injected seam whose first page
 * fails proves the seam is the one consulted — the temp home holds no key, so a job that ignored the seam would
 * answer with the key-missing refusal instead — and that a failed crawl writes nothing under the home.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { fathomIngestJob, readCap } from "../../../../corpus/fathom/ingest.js";
import { toIngestError } from "../../../../lib/ingestError.js";
import { err, unwrapErr } from "../../../../lib/result.js";
import type { FathomApi } from "../../../../live/fathom/api.js";

const WINDOW = { since: "2026-09-01", until: "2026-09-30" };

describe("readCap", () => {
  it("is undefined when neither bound was given", () => {
    expect(readCap({ fetchCap: undefined, sample: undefined })).toBe(undefined);
  });

  it("keeps a lone sample bound and a lone fetch-cap bound as given", () => {
    expect(readCap({ fetchCap: undefined, sample: 7 })).toEqual({ maxMeetings: 7 });
    expect(readCap({ fetchCap: 12, sample: undefined })).toEqual({ maxMeetings: 12 });
  });

  it("chooses the smaller value when both are given, in either position", () => {
    expect(readCap({ fetchCap: 30, sample: 4 })).toEqual({ maxMeetings: 4 });
    expect(readCap({ fetchCap: 3, sample: 40 })).toEqual({ maxMeetings: 3 });
  });

  it("passes a zero bound through as zero rather than treating it as absent", () => {
    expect(readCap({ fetchCap: undefined, sample: 0 })).toEqual({ maxMeetings: 0 });
    expect(readCap({ fetchCap: 0, sample: 5 })).toEqual({ maxMeetings: 0 });
  });
});

describe("fathomIngestJob", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A fresh, empty home that holds no Fathom key. */
  function emptyHome(): string {
    const home = mkdtempSync(join(tmpdir(), "fathom-ingest-"));
    homes.push(home);
    return home;
  }

  /** A seam whose every page fails with one boundary error, counting the pages asked for. */
  function failingApi({ calls, error }: { calls: string[]; error: Error }): FathomApi {
    return {
      listMeetings: async (input) => {
        calls.push(JSON.stringify(input));
        return err(toIngestError({ error, operation: "fathom.listMeetings", provider: "fathom" }));
      },
    };
  }

  it("describes the fathom source with its label and the planned window", () => {
    const job = fathomIngestJob({
      api: failingApi({ calls: [], error: new Error("unused") }),
      home: "/unused",
      window: WINDOW,
    });

    expect({ label: job.label, source: job.source, window: job.window }).toEqual({
      label: "fathom (recorded calls)",
      source: "fathom",
      window: { since: "2026-09-01", until: "2026-09-30" },
    });
  });

  it("consults the injected seam rather than the stored key, and a failed first page writes nothing", async () => {
    const home = emptyHome();
    const calls: string[] = [];
    const job = fathomIngestJob({
      api: failingApi({ calls, error: new Error("socket hang up") }),
      home,
      window: WINDOW,
    });

    const outcome = await job.run();

    expect(unwrapErr(outcome)).toEqual(["fathom fetch failed"]);
    expect(calls.length).toBe(1);
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });

  it("reports a 401 on the first page as the revoked-key refusal", async () => {
    const home = emptyHome();
    const job = fathomIngestJob({
      api: failingApi({ calls: [], error: new Error("401 unauthorized") }),
      home,
      window: WINDOW,
    });

    const messages = unwrapErr(await job.run());

    expect(messages.length).toBe(1);
    expect(messages[0]).toContain("Fathom refused the stored API key");
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });
});
