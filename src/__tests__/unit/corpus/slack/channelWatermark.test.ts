import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  advanceSlackChannelWatermarks,
  computeChannelWatermarks,
  readSlackChannelWatermarks,
} from "../../../../corpus/slack/channelWatermark.js";
import { unwrap } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh, isolated `$SLOPWEAVER_HOME` for one round-trip. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-slack-wm-"));
  fixtureDirs.push(home);
  return home;
}

/** The clock these advances are judged against — after every fixture cursor here, so it caps nothing. */
const NOW = "2023-12-15T00:00:00.000Z";

describe("computeChannelWatermarks", () => {
  it("stores each channel's own max timestamp, not a pooled one", () => {
    const advances = computeChannelWatermarks({
      fallbackUntil: "2023-12-01",
      nowIso: NOW,
      observed: [
        { channel: "C_A", tsIso: "2023-11-02T00:00:00.000Z" },
        { channel: "C_A", tsIso: "2023-11-05T00:00:00.000Z" },
        { channel: "C_B", tsIso: "2023-11-03T00:00:00.000Z" },
      ],
      visited: ["C_A", "C_B"],
    });
    expect(advances).toEqual([
      { channel: "C_A", cursor: "2023-11-05T00:00:00.000Z", fullHistory: false },
      { channel: "C_B", cursor: "2023-11-03T00:00:00.000Z", fullHistory: false },
    ]);
  });

  it("records a VISITED channel that held nothing, so it is never re-backfilled from the epoch", () => {
    expect(
      computeChannelWatermarks({ fallbackUntil: "2023-12-01", nowIso: NOW, observed: [], visited: ["C_QUIET"] }),
    ).toEqual([{ channel: "C_QUIET", cursor: "2023-12-01", fullHistory: false }]);
  });

  it("records nothing for a channel that was never visited, even if a record names it", () => {
    expect(
      computeChannelWatermarks({
        fallbackUntil: "2023-12-01",
        nowIso: NOW,
        observed: [{ channel: "C_UNREAD", tsIso: "2023-11-01T00:00:00.000Z" }],
        visited: [],
      }),
    ).toEqual([]);
  });

  it("emits one advance per channel when the visited list repeats an id", () => {
    expect(
      computeChannelWatermarks({ fallbackUntil: "2023-12-01", nowIso: NOW, observed: [], visited: ["C_A", "C_A"] }),
    ).toEqual([{ channel: "C_A", cursor: "2023-12-01", fullHistory: false }]);
  });

  it("falls back to the window end when a channel's only timestamps are empty", () => {
    expect(
      computeChannelWatermarks({
        fallbackUntil: "2023-12-01",
        nowIso: NOW,
        observed: [{ channel: "C_A", tsIso: "" }],
        visited: ["C_A"],
      }),
    ).toEqual([{ channel: "C_A", cursor: "2023-12-01", fullHistory: false }]);
  });

  // The measured defect: `until` is today+1, so a channel read today that held nothing banked
  // tomorrow's date — and `reach.ts#planChannelOldest` hands that straight back as the next run's ingest floor.
  // Most of the hundreds of conversations on a real home carried exactly this value.
  it("refuses to bank a window end that is AHEAD of the clock, and banks the clock instead", () => {
    expect(
      computeChannelWatermarks({
        fallbackUntil: "2026-09-18",
        nowIso: "2026-09-17T12:20:00.000Z",
        observed: [],
        visited: ["D0SYN000003"],
      }),
    ).toEqual([{ channel: "D0SYN000003", cursor: "2026-09-17T12:20:00.000Z", fullHistory: false }]);
  });

  it("clamps an OBSERVED timestamp in the future too — a Slack ts is assigned at post time", () => {
    expect(
      computeChannelWatermarks({
        fallbackUntil: "2026-09-18",
        nowIso: "2026-09-17T12:20:00.000Z",
        observed: [{ channel: "C_A", tsIso: "2026-09-20T00:00:00.000Z" }],
        visited: ["C_A"],
      }),
    ).toEqual([{ channel: "C_A", cursor: "2026-09-17T12:20:00.000Z", fullHistory: false }]);
  });

  it("leaves a window end BEHIND the clock exactly where it is", () => {
    expect(
      computeChannelWatermarks({
        fallbackUntil: "2026-09-18",
        nowIso: "2026-09-25T09:00:00.000Z",
        observed: [],
        visited: ["C_A"],
      }),
    ).toEqual([{ channel: "C_A", cursor: "2026-09-18", fullHistory: false }]);
  });

  it("clamps nothing when the clock is unreadable — a broken clock is no evidence about a cursor", () => {
    expect(
      computeChannelWatermarks({
        fallbackUntil: "2026-09-18",
        nowIso: "not-a-date",
        observed: [],
        visited: ["C_A"],
      }),
    ).toEqual([{ channel: "C_A", cursor: "2026-09-18", fullHistory: false }]);
  });

  it("keeps the completion marker and message count while clamping the cursor", () => {
    expect(
      computeChannelWatermarks({
        fallbackUntil: "2026-09-18",
        fullHistory: ["D0SYN000003"],
        nowIso: "2026-09-17T12:20:00.000Z",
        observed: [],
        visited: ["D0SYN000003"],
        walkedMessages: new Map([["D0SYN000003", 161]]),
      }),
    ).toEqual([{ channel: "D0SYN000003", cursor: "2026-09-17T12:20:00.000Z", fullHistory: true, messages: 161 }]);
  });
});

describe("readSlackChannelWatermarks / advanceSlackChannelWatermarks", () => {
  it("reads back what it wrote", () => {
    const home = tempHome();
    const written = unwrap(
      advanceSlackChannelWatermarks({
        advances: [{ channel: "C_A", cursor: "2023-11-05T00:00:00.000Z", fullHistory: false }],
        home,
      }),
    );
    expect(written.path).toBe(stateHomePaths({ home }).corpus.slackChannelsWatermark);
    expect(readSlackChannelWatermarks({ home }).get("C_A")).toEqual({
      cursor: "2023-11-05T00:00:00.000Z",
      fullHistory: false,
    });
  });

  it("returns an empty map when no file exists", () => {
    expect(readSlackChannelWatermarks({ home: tempHome() }).size).toBe(0);
  });

  it("MAX-merges, so a narrower re-run cannot rewind a channel's cursor", () => {
    const home = tempHome();
    advanceSlackChannelWatermarks({
      advances: [{ channel: "C_A", cursor: "2023-11-05T00:00:00.000Z", fullHistory: false }],
      home,
    });
    advanceSlackChannelWatermarks({
      advances: [{ channel: "C_A", cursor: "2023-11-01T00:00:00.000Z", fullHistory: false }],
      home,
    });
    expect(readSlackChannelWatermarks({ home }).get("C_A")).toEqual({
      cursor: "2023-11-05T00:00:00.000Z",
      fullHistory: false,
    });
  });

  it("keeps channels written by an earlier run that this one did not visit", () => {
    const home = tempHome();
    advanceSlackChannelWatermarks({
      advances: [{ channel: "C_A", cursor: "2023-11-05T00:00:00.000Z", fullHistory: false }],
      home,
    });
    advanceSlackChannelWatermarks({
      advances: [{ channel: "C_B", cursor: "2023-11-06T00:00:00.000Z", fullHistory: false }],
      home,
    });
    expect([...readSlackChannelWatermarks({ home }).keys()].toSorted()).toEqual(["C_A", "C_B"]);
  });

  it("degrades an unparseable file to an empty map rather than throwing", () => {
    const home = tempHome();
    const path = stateHomePaths({ home }).corpus.slackChannelsWatermark;
    unwrap(advanceSlackChannelWatermarks({ advances: [{ channel: "C_A", cursor: "x", fullHistory: false }], home }));
    writeFileSync(path, "{ not json", "utf8");
    expect(readSlackChannelWatermarks({ home }).size).toBe(0);
  });

  it("drops a channel entry whose cursor is not a string", () => {
    const home = tempHome();
    unwrap(
      advanceSlackChannelWatermarks({ advances: [{ channel: "C_A", cursor: "2023-11-05", fullHistory: false }], home }),
    );
    writeFileSync(
      stateHomePaths({ home }).corpus.slackChannelsWatermark,
      JSON.stringify({ channels: { C_A: { cursor: 7 }, C_B: { cursor: "2023-11-06" } }, version: 1 }),
      "utf8",
    );
    expect([...readSlackChannelWatermarks({ home }).keys()]).toEqual(["C_B"]);
  });
});
