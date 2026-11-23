/**
 * `profile words`' flags: the two modes, every refusal, and the window a list reads.
 */
import { describe, expect, it } from "vitest";

import { parseProfileWordsArgs, wordsWindow } from "../../../../../cli/commands/profile/wordsArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const NOW = "2026-10-04T12:00:00.000Z";

describe("parseProfileWordsArgs", () => {
  it("lists the last seven days, twenty at a time, when nothing is typed", () => {
    const args = unwrap(parseProfileWordsArgs({ rest: [] }));

    expect(args).toEqual({
      anchor: undefined,
      full: false,
      home: undefined,
      how: undefined,
      json: false,
      limit: 20,
      now: undefined,
      phrase: undefined,
      since: "7d",
      until: undefined,
    });
  });

  it("takes every list flag", () => {
    const args = unwrap(
      parseProfileWordsArgs({
        rest: ["--phrase", "atlas", "--since", "1d", "--how", "written", "--limit", "5", "--full", "--json"],
      }),
    );

    expect([args.phrase, args.since, args.how, args.limit, args.full, args.json]).toEqual([
      "atlas",
      "1d",
      "written",
      5,
      true,
      true,
    ]);
  });

  it("reads one anchor whole", () => {
    const args = unwrap(parseProfileWordsArgs({ rest: ["talk:abc", "--json"] }));

    expect([args.anchor, args.json]).toEqual(["talk:abc", true]);
  });

  it("refuses a list flag beside an anchor, naming each", () => {
    const problems = unwrapErr(parseProfileWordsArgs({ rest: ["talk:abc", "--phrase", "x", "--full"] }));

    expect(problems).toEqual(["an anchor is read whole, so --phrase, --full cannot be given with it"]);
  });

  it("refuses two anchors", () => {
    expect(unwrapErr(parseProfileWordsArgs({ rest: ["talk:a", "talk:b"] }))).toEqual(["one anchor at a time — got 2"]);
  });

  it("gathers every bad value at once", () => {
    const problems = unwrapErr(parseProfileWordsArgs({ rest: ["--how", "sung", "--limit", "0", "--now", "later"] }));

    expect(problems).toEqual([
      "--now later is not an instant",
      "--how sung is neither spoken nor written",
      "--limit 0 is not a whole number from 1 to 500",
    ]);
  });

  it("refuses a limit past the cap and a fraction", () => {
    expect(unwrapErr(parseProfileWordsArgs({ rest: ["--limit", "501"] }))).toEqual([
      "--limit 501 is not a whole number from 1 to 500",
    ]);
    expect(unwrapErr(parseProfileWordsArgs({ rest: ["--limit", "2.5"] }))).toEqual([
      "--limit 2.5 is not a whole number from 1 to 500",
    ]);
  });

  it("refuses an empty phrase rather than reading it as every turn, beside any other mistake", () => {
    expect(unwrapErr(parseProfileWordsArgs({ rest: ["--phrase", "  ", "--how", "sung"] }))).toEqual([
      "--how sung is neither spoken nor written",
      "--phrase is empty — leave it off to list every turn",
    ]);
  });

  it("refuses a phrase of only words too common to search on, which would match every turn", () => {
    expect(unwrapErr(parseProfileWordsArgs({ rest: ["--phrase", "and is it about"] }))).toEqual([
      "--phrase and is it about holds only words too common to search on — name something they would have said",
    ]);
  });

  it("names a bad bound beside every other mistake, before any clock is read", () => {
    expect(
      unwrapErr(parseProfileWordsArgs({ rest: ["--how", "sung", "--since", "lately", "--until", "soon"] })),
    ).toEqual([
      "--how sung is neither spoken nor written",
      "--until soon is not an instant",
      "--since lately is neither an instant nor a span like 7d or 12h",
    ]);
  });

  // `Date.parse` takes `0` and a US date, and rolls an impossible day into the next month.
  it("refuses a bound Date.parse would take that is no ISO instant, and keeps one with an offset", () => {
    expect(
      unwrapErr(
        parseProfileWordsArgs({ rest: ["--since", "0", "--until", "10/05/2026", "--now", "2026-02-30T00:00Z"] }),
      ),
    ).toEqual([
      "--now 2026-02-30T00:00Z is not an instant",
      "--until 10/05/2026 is not an instant",
      "--since 0 is neither an instant nor a span like 7d or 12h",
    ]);
    expect(unwrap(parseProfileWordsArgs({ rest: ["--since", "2026-10-04T09:00+10:00"] })).since).toBe(
      "2026-10-04T09:00+10:00",
    );
  });

  it("refuses a flag it does not take", () => {
    expect(unwrapErr(parseProfileWordsArgs({ rest: ["--loud"] })).length).toBe(1);
  });
});

describe("wordsWindow", () => {
  it("counts a span in days back from now, up to now", () => {
    expect(unwrap(wordsWindow({ nowIso: NOW, since: "7d", until: undefined }))).toEqual({
      sinceIso: "2026-09-27T12:00:00.000Z",
      untilIso: NOW,
    });
  });

  it("counts a span in hours", () => {
    expect(unwrap(wordsWindow({ nowIso: NOW, since: "12h", until: undefined })).sinceIso).toBe(
      "2026-10-04T00:00:00.000Z",
    );
  });

  it("takes two instants, spelled any way Date reads them", () => {
    expect(
      unwrap(wordsWindow({ nowIso: NOW, since: "2026-10-01T00:00:00+10:00", until: "2026-10-02T00:00:00Z" })),
    ).toEqual({ sinceIso: "2026-09-30T14:00:00.000Z", untilIso: "2026-10-02T00:00:00.000Z" });
  });

  it("refuses a since that is neither", () => {
    expect(unwrapErr(wordsWindow({ nowIso: NOW, since: "lately", until: undefined }))).toEqual([
      "--since lately is neither an instant nor a span like 7d or 12h",
    ]);
  });

  it("refuses an until that is not an instant", () => {
    expect(unwrapErr(wordsWindow({ nowIso: NOW, since: "1d", until: "soon" }))).toEqual([
      "--until soon is not an instant",
    ]);
  });

  it("names both bounds when neither reads, and no empty window beside them", () => {
    expect(unwrapErr(wordsWindow({ nowIso: NOW, since: "lately", until: "soon" }))).toEqual([
      "--until soon is not an instant",
      "--since lately is neither an instant nor a span like 7d or 12h",
    ]);
  });

  it("refuses a window that holds nothing", () => {
    expect(unwrapErr(wordsWindow({ nowIso: NOW, since: NOW, until: undefined }))).toEqual([
      `--since ${NOW} is not before --until — the window holds nothing`,
    ]);
  });
});
