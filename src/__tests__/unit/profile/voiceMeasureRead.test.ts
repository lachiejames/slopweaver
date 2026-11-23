/**
 * Reading the owner's sent Slack out of a home's bronze corpus: whose messages, which files, and every way of measuring
 * nothing or measuring wrong — each one named, none silent.
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { readSlackVoiceMeasurement } from "../../../profile/voiceMeasureRead.js";

import { voiceHome as home, NOW, OTHER, OWNER, removeVoiceHomes, voiceRow as row } from "./voiceMeasureFixture.js";

afterEach(() => {
  removeVoiceHomes();
});

describe("readSlackVoiceMeasurement", () => {
  it("skips, naming why, when profile.json declares no owner id", () => {
    const outcome = unwrap(readSlackVoiceMeasurement({ home: home({ files: {} }), nowIso: NOW }));
    expect(outcome).toMatchObject({ kind: "skipped", reason: "owner-user-id-absent" });
  });

  it("fails, naming the file, when profile.json is not one it can trust", () => {
    const dir = home({ ownerId: OWNER });
    writeFileSync(join(dir, "profile.json"), "{ not json");
    const failure = unwrapErr(readSlackVoiceMeasurement({ home: dir, nowIso: NOW }));
    expect(failure.code).toBe("VOICE_MEASURE_PROFILE_UNREADABLE");
    expect(failure.message).toContain("because whose Slack messages to measure is read from it");
  });

  it("skips when the home holds no Slack corpus directory at all", () => {
    const outcome = unwrap(readSlackVoiceMeasurement({ home: home({ ownerId: OWNER }), nowIso: NOW }));
    expect(outcome).toStrictEqual({
      kind: "skipped",
      message: "this home holds no Slack corpus yet — a Slack refresh writes it",
      reason: "no-slack-bronze",
    });
  });

  it("skips when the Slack corpus directory holds no file", () => {
    const outcome = unwrap(readSlackVoiceMeasurement({ home: home({ files: {}, ownerId: OWNER }), nowIso: NOW }));
    expect(outcome).toStrictEqual({
      kind: "skipped",
      message: "this home holds no Slack corpus yet — a Slack refresh writes it",
      reason: "no-slack-bronze",
    });
  });

  it("fails, rather than skipping, when the corpus path cannot be looked at", () => {
    const dir = home({ ownerId: OWNER });
    mkdirSync(join(dir, "corpus"), { recursive: true });
    writeFileSync(join(dir, "corpus", "bronze"), "a file where a directory belongs");
    const failure = unwrapErr(readSlackVoiceMeasurement({ home: dir, nowIso: NOW }));
    expect(failure.code).toBe("VOICE_MEASURE_CORPUS_UNREADABLE");
    expect(failure.message).toContain("could not be read");
  });

  it("fails when one bronze file cannot be read whole", () => {
    const dir = home({ files: { "a.jsonl": [row({ id: "1", text: "one two" })] }, ownerId: OWNER });
    const path = join(dir, "corpus", "bronze", "slack", "a.jsonl");
    chmodSync(path, 0o000);
    const failure = unwrapErr(readSlackVoiceMeasurement({ home: dir, nowIso: NOW }));
    chmodSync(path, 0o600);
    expect(failure).toMatchObject({ code: "VOICE_MEASURE_CORPUS_UNREADABLE", path });
  });

  it("fails when a directory inside the Slack corpus cannot be listed", () => {
    const dir = home({ files: { "a.jsonl": [row({ id: "1", text: "one two" })] }, ownerId: OWNER });
    const nested = join(dir, "corpus", "bronze", "slack", "archived");
    mkdirSync(nested);
    chmodSync(nested, 0o000);
    const failure = unwrapErr(readSlackVoiceMeasurement({ home: dir, nowIso: NOW }));
    chmodSync(nested, 0o700);
    expect(failure).toMatchObject({ code: "VOICE_MEASURE_CORPUS_UNREADABLE", path: nested });
  });

  it("refuses, rather than skipping as empty, when the protect list marks the Slack corpus no-access", () => {
    const dir = home({ files: { "a.jsonl": [row({ id: "1", text: "one two" })] }, ownerId: OWNER });
    const slack = join(dir, "corpus", "bronze", "slack");
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: slack, why: "fixture" };
    const failure = unwrapErr(readSlackVoiceMeasurement({ home: dir, nowIso: NOW, protection: () => ok([entry]) }));
    expect(failure.code).toBe("VOICE_MEASURE_CORPUS_PROTECTED");
    expect(failure.message).toBe(
      `refusing to measure the owner's Slack voice: it would list ${slack}, which the owner's protect list marks ` +
        `no-access at ${slack} (fixture) — nothing was measured`,
    );
  });

  it("leaves out a row of the owner's that stored no Slack payload", () => {
    const bare = row({ id: "2", text: "no payload" }).replace(/"raw":\{[^}]*\},/, "");
    expect(bare).not.toContain('"raw"');
    const dir = home({ files: { "a.jsonl": [row({ id: "1", text: "one two" }), bare] }, ownerId: OWNER });
    const outcome = unwrap(readSlackVoiceMeasurement({ home: dir, nowIso: NOW }));
    expect(outcome.measurement!.counts.excludedNoRawText).toBe(1);
    expect(outcome.measurement!.counts.eligibleAllSent).toBe(1);
  });

  it("measures the owner's rows across every file, and nobody else's", () => {
    const dir = home({
      files: {
        "a.jsonl": [row({ id: "1", text: "one two three" }), row({ author: OTHER, id: "2", text: "x ".repeat(50) })],
        "b.jsonl": [row({ channel: "D0SYNDMCH01", id: "3", text: "five words in this one" })],
      },
      ownerId: OWNER,
    });
    const outcome = unwrap(readSlackVoiceMeasurement({ home: dir, nowIso: NOW }));
    expect(outcome).toMatchObject({ filesRead: 2, kind: "measured" });
    expect(
      outcome.measurement!.cohorts.map((cohort) => [cohort.surface, cohort.sampleCount, cohort.medianWords]),
    ).toEqual([
      ["slack", 2, 3],
      ["slack-dm", 1, 5],
    ]);
  });

  it("skips, carrying the counts, when every one of the owner's rows was app-posted", () => {
    const dir = home({
      files: { "a.jsonl": [row({ id: "1", raw: { bot_id: "B0SYNAPP001" }, text: "posted by the fleet" })] },
      ownerId: OWNER,
    });
    const outcome = unwrap(readSlackVoiceMeasurement({ home: dir, nowIso: NOW }));
    expect(outcome).toMatchObject({ kind: "skipped", reason: "no-eligible-messages" });
    expect(outcome.measurement!.counts.excludedAppBotId).toBe(1);
  });

  it("fails rather than measuring without a line naming the owner that will not parse", () => {
    const dir = home({
      files: { "a.jsonl": [row({ id: "1", text: "fine" }), `{"author":"${OWNER}",`] },
      ownerId: OWNER,
    });
    const failure = unwrapErr(readSlackVoiceMeasurement({ home: dir, nowIso: NOW }));
    expect(failure.code).toBe("VOICE_MEASURE_ROW_MALFORMED");
    expect(failure.message).toContain("line 2 names the owner's Slack id but does not parse");
  });

  it("fails on a malformed line that could spell the owner's id through a JSON escape", () => {
    const escaped = `\\u0055${OWNER.slice(1)}`;
    const dir = home({
      files: { "a.jsonl": [row({ id: "1", text: "fine" }), `{"author":"${escaped}",`] },
      ownerId: OWNER,
    });
    expect(unwrapErr(readSlackVoiceMeasurement({ home: dir, nowIso: NOW })).code).toBe("VOICE_MEASURE_ROW_MALFORMED");
  });

  it("ignores a malformed line that does not name the owner", () => {
    const dir = home({
      files: { "a.jsonl": [row({ id: "1", text: "fine" }), `{"author":"${OTHER}",`] },
      ownerId: OWNER,
    });
    const outcome = unwrap(readSlackVoiceMeasurement({ home: dir, nowIso: NOW }));
    expect(outcome.kind).toBe("measured");
  });
});
