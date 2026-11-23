/**
 * The `transcripts` parsers and the window they resolve to. Pure — nothing here touches a transcript.
 */
import { describe, expect, it } from "vitest";

import {
  parseTranscriptsErrorsArgs,
  parseTranscriptsSessionsArgs,
  parseTranscriptsSummaryArgs,
  parseTranscriptsTurnsArgs,
  resolveLimit,
  resolveTimeWindow,
  TRANSCRIPTS_ERRORS_FLAG_NAMES,
  TRANSCRIPTS_SESSIONS_FLAG_NAMES,
  TRANSCRIPTS_SUMMARY_FLAG_NAMES,
  TRANSCRIPTS_TURNS_FLAG_NAMES,
  transcriptsTail,
} from "../../../../../cli/commands/transcripts/core.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const NOW_ISO = "2026-08-28T00:00:00.000Z";

describe("transcriptsTail", () => {
  it("drops a spoken verb so the parser never sees it as a positional", () => {
    expect(transcriptsTail({ argv: ["node", "cli", "transcripts", "sessions", "--json"] })).toStrictEqual(["--json"]);
  });

  it("keeps the whole tail when the verb was defaulted", () => {
    expect(transcriptsTail({ argv: ["node", "cli", "transcripts", "--json"] })).toStrictEqual(["--json"]);
  });

  it("returns nothing for a bare noun", () => {
    expect(transcriptsTail({ argv: ["node", "cli", "transcripts"] })).toStrictEqual([]);
  });
});

describe("the parsers", () => {
  it("accepts every flag `sessions` advertises", () => {
    const parsed = unwrap(
      parseTranscriptsSessionsArgs({
        rest: [
          "--projects",
          "/p",
          "--since",
          "7d",
          "--until",
          "2026-08-20",
          "--project",
          "slop",
          "--limit",
          "5",
          "--json",
        ],
      }),
    );
    expect(parsed.values["project"]).toBe("slop");
    expect(parsed.values["json"]).toBe(true);
  });

  it("REFUSES an unknown flag on every verb", () => {
    expect(unwrapErr(parseTranscriptsSessionsArgs({ rest: ["--grep"] }))).toStrictEqual(["unknown flag: --grep"]);
    expect(unwrapErr(parseTranscriptsTurnsArgs({ rest: ["--grep"] }))).toStrictEqual(["unknown flag: --grep"]);
    expect(unwrapErr(parseTranscriptsSummaryArgs({ rest: ["--grep"] }))).toStrictEqual(["unknown flag: --grep"]);
    expect(unwrapErr(parseTranscriptsErrorsArgs({ rest: ["--grep"] }))).toStrictEqual(["unknown flag: --grep"]);
  });

  it("advertises the same flag names the ratchet compares against usage", () => {
    expect(TRANSCRIPTS_SESSIONS_FLAG_NAMES).toStrictEqual([
      "--json",
      "--limit",
      "--project",
      "--projects",
      "--since",
      "--until",
    ]);
    expect(TRANSCRIPTS_TURNS_FLAG_NAMES).toStrictEqual([
      "--full",
      "--json",
      "--limit",
      "--project",
      "--projects",
      "--session",
      "--since",
      "--until",
    ]);
    expect(TRANSCRIPTS_SUMMARY_FLAG_NAMES).toStrictEqual([
      "--json",
      "--project",
      "--projects",
      "--session",
      "--since",
      "--until",
    ]);
    expect(TRANSCRIPTS_ERRORS_FLAG_NAMES).toStrictEqual([
      "--json",
      "--limit",
      "--project",
      "--projects",
      "--session",
      "--since",
      "--until",
    ]);
  });
});

describe("resolveTimeWindow", () => {
  it("resolves a relative --since against the injected clock", () => {
    expect(unwrap(resolveTimeWindow({ nowIso: NOW_ISO, sinceFlag: "7d", untilFlag: undefined })).sinceMs).toBe(
      Date.parse("2026-08-21"),
    );
  });

  it("resolves an ISO --since verbatim", () => {
    expect(
      unwrap(resolveTimeWindow({ nowIso: NOW_ISO, sinceFlag: "2026-08-01T06:00:00.000Z", untilFlag: undefined }))
        .sinceMs,
    ).toBe(Date.parse("2026-08-01T06:00:00.000Z"));
  });

  it("leaves both halves absent when neither flag was given", () => {
    expect(unwrap(resolveTimeWindow({ nowIso: NOW_ISO, sinceFlag: undefined, untilFlag: undefined }))).toStrictEqual({
      sinceMs: undefined,
      untilMs: undefined,
    });
  });

  it("REFUSES a --since that is neither shape, and says both shapes in the refusal", () => {
    expect(unwrapErr(resolveTimeWindow({ nowIso: NOW_ISO, sinceFlag: "last tuesday", untilFlag: undefined }))[0]).toBe(
      '--since must be an ISO date/timestamp or "<N>d" (e.g. 2026-08-01 or 7d) — got: last tuesday',
    );
  });

  it("REFUSES an unparseable --until", () => {
    expect(unwrapErr(resolveTimeWindow({ nowIso: NOW_ISO, sinceFlag: undefined, untilFlag: "soon" })).length).toBe(1);
  });

  it("REFUSES a window whose end precedes its start rather than silently answering nothing", () => {
    expect(
      unwrapErr(resolveTimeWindow({ nowIso: NOW_ISO, sinceFlag: "2026-08-10", untilFlag: "2026-08-01" })),
    ).toStrictEqual(["--until is before --since, so the window is empty — swap them"]);
  });
});

describe("resolveLimit", () => {
  it("falls back when the flag was not given", () => {
    expect(unwrap(resolveLimit({ fallback: 40, raw: undefined }))).toBe(40);
  });

  it("accepts a positive whole number", () => {
    expect(unwrap(resolveLimit({ fallback: 40, raw: "5" }))).toBe(5);
  });

  it("REFUSES zero, a negative and a fraction", () => {
    expect(unwrapErr(resolveLimit({ fallback: 40, raw: "0" })).length).toBe(1);
    expect(unwrapErr(resolveLimit({ fallback: 40, raw: "-3" })).length).toBe(1);
    expect(unwrapErr(resolveLimit({ fallback: 40, raw: "2.5" })).length).toBe(1);
  });

  it("REFUSES a non-numeric limit", () => {
    expect(unwrapErr(resolveLimit({ fallback: 40, raw: "lots" }))).toStrictEqual([
      "--limit must be a positive whole number — got: lots",
    ]);
  });
});
