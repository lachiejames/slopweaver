/**
 * What every turn poster needs before it renders: the owner tag, decided from one read of `profile.json` as
 * the fixed `owner` key mapped to the configured id, or no key and the empty resolution when no owner is
 * declared; and one frame of the working card, every person it tags handed to the name lookup once and
 * named, the injected millisecond clock FLOORED to epoch seconds, rendered by the one turn renderer.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CardNames } from "../../../../live/turn/cardNames.js";
import { NO_MENTIONS, ownerTag, turnFrame } from "../../../../live/turn/posterFrame.js";
import { renderTurnMessage } from "../../../../outbound/assistant/turnMessage.js";
import type { TurnChrome } from "../../../../outbound/slack/types.js";

const CHROME: TurnChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#8B5CF6",
  detailLabel: "*Details*",
  metadataEventType: "test_turn_v1",
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "poster-frame-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("NO_MENTIONS", () => {
  it("resolves no person and no group", () => {
    expect([...NO_MENTIONS.people.entries()]).toEqual([]);
    expect([...NO_MENTIONS.groups.entries()]).toEqual([]);
  });
});

describe("ownerTag", () => {
  it("is no key and the empty resolution when the home has no profile", () => {
    const tag = ownerTag({ home });

    expect(tag.key).toBeUndefined();
    expect(tag.mentions).toBe(NO_MENTIONS);
  });

  it("is the fixed owner key mapped to the profile's owner id, and nothing else", () => {
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "Ada Owner",
        gitNamespace: "ada-gh",
        id: "owner-1",
        schemaVersion: 1,
        slackBot: { ownerUserId: "U0OWNER1" },
        sources: ["github"],
      }),
      "utf8",
    );

    const tag = ownerTag({ home });

    expect(tag.key).toBe("owner");
    expect([...tag.mentions.people.entries()]).toEqual([["owner", "U0OWNER1"]]);
    expect([...tag.mentions.groups.entries()]).toEqual([]);
  });
});

describe("turnFrame", () => {
  it("names every tagged person once, floors the clock to seconds, and renders through the turn renderer", () => {
    const asked: (readonly string[])[] = [];
    const names = ({ ids }: { ids: readonly string[] }): CardNames => {
      asked.push(ids);
      return { U0SYNADA0001: "Ada Lovelace" };
    };

    const payload = turnFrame({
      names,
      now: () => 1_785_192_578_999,
      provenance: { modelId: "claude-opus" },
      steps: [
        { detail: "asked by @(U0SYNADA0001)", id: "question", state: "done", title: "Read @(U0SYNBOB0002)'s question" },
        { children: ["cc @(U0SYNADA0001)"], id: "answer", state: "running", title: "Compose the answer" },
      ],
      task: "answering @(U0SYNADA0001)",
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    expect(asked).toEqual([["U0SYNADA0001", "U0SYNBOB0002"]]);
    expect(payload).toEqual(
      renderTurnMessage({
        asOfEpochSeconds: 1_785_192_578,
        asOfFallback: "just now",
        chrome: CHROME,
        modelId: "claude-opus",
        steps: [
          { detail: "asked by @Ada Lovelace", id: "question", state: "done", title: "Read @(U0SYNBOB0002)'s question" },
          { children: ["cc @Ada Lovelace"], id: "answer", state: "running", title: "Compose the answer" },
        ],
        task: "answering @Ada Lovelace",
        turnId: "turn-1",
      }),
    );
    expect(JSON.stringify(payload)).toContain("_todos as of <!date^1785192578^{time} ({ago})|just now>_");
    expect(payload.metadata).toEqual({
      event_payload: { renderer: "slack-turn-v1", schemaVersion: 1, turnId: "turn-1" },
      event_type: "test_turn_v1",
    });
  });
});
