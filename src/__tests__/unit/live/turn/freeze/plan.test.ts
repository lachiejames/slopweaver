/**
 * Which files a freeze reads, and the two path questions it has to answer before it reads any of them.
 */
import { describe, expect, it } from "vitest";

import {
  freezeDirectorySources,
  freezeSources,
  insideHome,
  relativeToHome,
} from "../../../../../live/turn/freeze/plan.js";

/**
 * Assembled rather than written, for the reason `redact.test.ts` gives at length: a workspace-id-shaped
 * literal and an absolute home path are both leak CLASSES the hygiene gate flags in a committed file, and
 * these are invented values that merely have those shapes.
 */
const HOME = ["", "Users", "tester", ".slopweaver"].join("/");
const CHANNEL = `C${"0QWERTY12"}`;
const ASK = { channel: CHANNEL, messageTs: "1787878821.099679" };
const KEY = `${CHANNEL}-1787878821.099679`;

describe("freezeSources", () => {
  it("names the brief as the one required source", () => {
    expect(freezeSources({ askIdentity: ASK, home: HOME }).filter((source) => source.required)).toHaveLength(1);
  });

  it("lands every source at a home-relative path", () => {
    expect(freezeSources({ askIdentity: ASK, home: HOME }).map((source) => source.to)).toEqual([
      `briefs/${KEY}.json`,
      `live/slack/dispatches/${KEY}.json`,
      `live/slack/turn-markers/${KEY}.json`,
      `live/slack/reviews/${KEY}/record.json`,
      `live/slack/reviews/${KEY}/verdict.json`,
    ]);
  });

  it("reads every source out of the home it was given", () => {
    expect(freezeSources({ askIdentity: ASK, home: HOME }).every((source) => source.from.startsWith(HOME))).toBe(true);
  });
});

describe("relativeToHome", () => {
  it("strips the home prefix", () => {
    expect(relativeToHome({ home: HOME, path: `${HOME}/briefs/x.json` })).toBe("briefs/x.json");
  });
});

describe("insideHome", () => {
  it("accepts a path under the home", () => {
    expect(insideHome({ home: HOME, path: `${HOME}/tmp/answer.json` })).toBe(true);
  });

  it("rejects a path outside the home", () => {
    expect(insideHome({ home: HOME, path: ["", "Users", "tester", "dev", "answer.json"].join("/") })).toBe(false);
  });

  it("rejects a sibling directory whose name merely starts with the home's", () => {
    expect(insideHome({ home: HOME, path: `${HOME}2/answer.json` })).toBe(false);
  });

  it("rejects the home itself, which names no file", () => {
    expect(insideHome({ home: HOME, path: HOME })).toBe(false);
  });

  it("rejects a bare relative name — the measured case an answer was lost to", () => {
    expect(insideHome({ home: HOME, path: "answer.json" })).toBe(false);
  });
});

describe("freezeDirectorySources", () => {
  it("carries every round's verdict and reviewed answer, not just the last round's", () => {
    const sources = freezeDirectorySources({
      askIdentity: ASK,
      checkpointEntries: [],
      detectiveWaves: [],
      home: HOME,
      reviewEntries: [
        "record.json",
        "verdict.json",
        "packet.md",
        "verdict-superseded-a-2026-09-10T13-34-39-172Z.json",
        "verdict-superseded-b-2026-09-10T13-50-07-477Z.json",
        "answer-reviewed-sha256-aaaa.json",
      ],
    });

    expect(sources.map((source) => source.to)).toEqual([
      `live/slack/reviews/${KEY}/answer-reviewed-sha256-aaaa.json`,
      `live/slack/reviews/${KEY}/verdict-superseded-a-2026-09-10T13-34-39-172Z.json`,
      `live/slack/reviews/${KEY}/verdict-superseded-b-2026-09-10T13-50-07-477Z.json`,
    ]);
  });

  it("carries the checkpointed drafts and their own log", () => {
    const sources = freezeDirectorySources({
      askIdentity: ASK,
      checkpointEntries: ["log.jsonl", "draft-sha256-aaaa.json"],
      detectiveWaves: [],
      home: HOME,
      reviewEntries: [],
    });

    expect(sources.map((source) => source.to)).toEqual([
      `live/slack/checkpoints/${KEY}/draft-sha256-aaaa.json`,
      `live/slack/checkpoints/${KEY}/log.jsonl`,
    ]);
  });

  it("carries each detective wave's record and never its prose briefs or reports", () => {
    const sources = freezeDirectorySources({
      askIdentity: ASK,
      checkpointEntries: [],
      detectiveWaves: ["store-1789600000000", "recall-1789600000001"],
      home: HOME,
      reviewEntries: [],
    });

    expect(sources.map((source) => source.to)).toEqual([
      `live/slack/detectives/${KEY}/recall-1789600000001/wave.json`,
      `live/slack/detectives/${KEY}/store-1789600000000/wave.json`,
    ]);
  });

  it("names nothing required, and nothing at all for an ask with neither directory", () => {
    expect(
      freezeDirectorySources({
        askIdentity: ASK,
        checkpointEntries: [],
        detectiveWaves: [],
        home: HOME,
        reviewEntries: [],
      }),
    ).toEqual([]);
    expect(
      freezeDirectorySources({
        askIdentity: ASK,
        checkpointEntries: ["log.jsonl"],
        detectiveWaves: ["store-1789600000000"],
        home: HOME,
        reviewEntries: ["verdict-superseded-a-2026-09-10T13-34-39-172Z.json"],
      }).filter((source) => source.required),
    ).toEqual([]);
  });
});
