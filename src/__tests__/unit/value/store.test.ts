/**
 * The value-sample ledger: a week's sample round-trips through its file, a damaged file fails closed rather than
 * reading as absent, and an answer merges in without ever replacing one already recorded. Synthetic asks only.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import type { SampledAsk } from "../../../value/sample.js";
import {
  answerSample,
  createSample,
  parseSample,
  readSample,
  sampleComplete,
  samplePath,
  type ValueSample,
  writeSample,
} from "../../../value/store.js";

/** One drawn ask, filed into a doc, its cost measured. */
const drawn = (over: Partial<SampledAsk> = {}): SampledAsk => ({
  artifact: undefined,
  cost: { known: true, value: { coveredTurns: 2, totalTurns: 2, transcripts: 1, units: 150 } },
  prUrls: ["https://github.com/acme/widgets/pull/1"],
  prs: [{ state: "MERGED", url: "https://github.com/acme/widgets/pull/1" }],
  settledIso: "2026-11-20T00:00:00.000Z",
  settlement: "filed",
  slug: "acme-ask",
  summary: "Export the widget report",
  witness: "acme-doc",
  ...over,
});

/** A two-ask sample for week 48, unanswered. */
const sample = (over: Partial<ValueSample> = {}): ValueSample => ({
  answers: {},
  asks: [drawn(), drawn({ cost: { known: false, why: "no seat" }, slug: "acme-other", witness: undefined })],
  drawnIso: "2026-11-23T07:00:00.000Z",
  eligible: 7,
  schemaVersion: 1,
  week: "2026-W48",
  ...over,
});

const homes: string[] = [];

/** A throwaway state home, removed after each test. */
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "value-store-"));
  homes.push(home);
  return home;
};

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("writeSample and readSample", () => {
  it("reads back exactly the sample written, an absent artifact and witness included", () => {
    const home = freshHome();
    const written = writeSample({ home, sample: sample() });
    expect(unwrap(written)).toBe(samplePath({ home, week: "2026-W48" }));
    expect(unwrap(readSample({ home, week: "2026-W48" }))).toEqual(sample());
  });

  it("reads a week never drawn as no sample", () => {
    expect(unwrap(readSample({ home: freshHome(), week: "2026-W48" }))).toBe(undefined);
  });

  it("refuses a week id that is not one, before it reaches a path", () => {
    const read = readSample({ home: freshHome(), week: "../escape" });
    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr().code).toBe("SAMPLE_INVALID");
    expect(read._unsafeUnwrapErr().message).toContain("../escape is not an ISO week id");
  });

  it("fails closed on a damaged file rather than reading it as absent", () => {
    const home = freshHome();
    const path = samplePath({ home, week: "2026-W48" });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json");
    const read = readSample({ home, week: "2026-W48" });
    expect(read._unsafeUnwrapErr().code).toBe("SAMPLE_INVALID");
    expect(read._unsafeUnwrapErr().message).toContain("not JSON");
  });
});

describe("createSample", () => {
  it("keeps a first draw, and reads back exactly what it kept", () => {
    const home = freshHome();
    expect(unwrap(createSample({ home, sample: sample() }))).toBe("created");
    expect(unwrap(readSample({ home, week: "2026-W48" }))).toEqual(sample());
  });

  it("never replaces a week already kept, so an answer recorded against it survives a second draw", () => {
    const home = freshHome();
    const answered = sample({ answers: { "acme-ask": { answer: "used", answeredIso: "2026-11-23T08:00:00.000Z" } } });
    unwrap(writeSample({ home, sample: answered }));
    expect(unwrap(createSample({ home, sample: sample({ eligible: 3 }) }))).toBe("exists");
    expect(unwrap(readSample({ home, week: "2026-W48" }))).toEqual(answered);
  });

  it("leaves no staging file behind either way", () => {
    const home = freshHome();
    unwrap(createSample({ home, sample: sample() }));
    unwrap(createSample({ home, sample: sample() }));
    expect(readdirSync(dirname(samplePath({ home, week: "2026-W48" })))).toEqual(["2026-W48.json"]);
  });
});

describe("parseSample", () => {
  it("refuses JSON that is not a sample, naming the path", () => {
    const parsed = parseSample({ path: "/h/2026-W48.json", text: JSON.stringify({ ...sample(), schemaVersion: 2 }) });
    expect(parsed._unsafeUnwrapErr().code).toBe("SAMPLE_INVALID");
    expect(parsed._unsafeUnwrapErr().message).toContain("/h/2026-W48.json is not a value sample");
  });

  it("refuses an answer outside used, not-used and not-yet", () => {
    const text = JSON.stringify({ ...sample(), answers: { "acme-ask": { answer: "maybe", answeredIso: "x" } } });
    expect(parseSample({ path: "p", text })._unsafeUnwrapErr().code).toBe("SAMPLE_INVALID");
  });
});

describe("answerSample", () => {
  const NOW = "2026-11-24T09:00:00.000Z";

  it("merges a first answer in, stamped with when it was recorded", () => {
    const answered = unwrap(answerSample({ answer: "used", nowIso: NOW, sample: sample(), slug: "acme-ask" }));
    expect(answered.changed).toBe(true);
    expect(answered.sample.answers).toEqual({ "acme-ask": { answer: "used", answeredIso: NOW } });
  });

  it("takes the same answer again as a no-op, keeping the first stamp", () => {
    const before = sample({ answers: { "acme-ask": { answer: "used", answeredIso: "2026-11-23T08:00:00.000Z" } } });
    const again = unwrap(answerSample({ answer: "used", nowIso: NOW, sample: before, slug: "acme-ask" }));
    expect(again.changed).toBe(false);
    expect(again.sample).toBe(before);
  });

  it("refuses a different answer for an ask already answered", () => {
    const before = sample({ answers: { "acme-ask": { answer: "used", answeredIso: NOW } } });
    const refused = answerSample({ answer: "not-used", nowIso: NOW, sample: before, slug: "acme-ask" });
    expect(refused._unsafeUnwrapErr().code).toBe("ANSWER_CONFLICT");
    expect(refused._unsafeUnwrapErr().message).toBe(
      "acme-ask is already answered used; refusing not-used — a recorded answer is never replaced",
    );
  });

  it("refuses an ask the week did not draw", () => {
    const refused = answerSample({ answer: "used", nowIso: NOW, sample: sample(), slug: "acme-stranger" });
    expect(refused._unsafeUnwrapErr().code).toBe("ASK_NOT_SAMPLED");
    expect(refused._unsafeUnwrapErr().message).toBe("acme-stranger is not one of the asks the 2026-W48 sample drew");
  });
});

describe("sampleComplete", () => {
  it("is complete only once every drawn ask carries an answer", () => {
    const one = { "acme-ask": { answer: "used" as const, answeredIso: "t" } };
    expect(sampleComplete({ sample: sample() })).toBe(false);
    expect(sampleComplete({ sample: sample({ answers: one }) })).toBe(false);
    expect(
      sampleComplete({
        sample: sample({ answers: { ...one, "acme-other": { answer: "not-yet", answeredIso: "t" } } }),
      }),
    ).toBe(true);
  });
});
