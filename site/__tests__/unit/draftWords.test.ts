import { describe, expect, it } from "vitest";
import type { DraftLine } from "../../components/live/readSlackDraftsRuns";
import { draftGroupLabel, draftLinesWords } from "../../lib/draftWords";

const PLAIN = { bold: false, code: false, italic: false, kind: "text" } as const;

describe("draftLinesWords", () => {
  it("reads the words the card draws, chips and list markers included, one line per line", () => {
    const lines: readonly DraftLine[] = [
      {
        frame: undefined,
        marker: undefined,
        runs: [
          { ...PLAIN, text: "Visible B for " },
          { kind: "user", userId: "U0ALICE" },
          { ...PLAIN, text: " and " },
          { groupId: "S0OPS", handle: undefined, kind: "usergroup" },
          { ...PLAIN, text: " in " },
          { channelId: "C0ENG", kind: "channel" },
        ],
      },
      {
        frame: undefined,
        marker: "•",
        runs: [
          { kind: "link", label: "the runbook", url: "https://example.com/runbook" },
          { ...PLAIN, text: " " },
          { kind: "emoji", name: "tada", skinTone: undefined, unicode: "1f389" },
          { ...PLAIN, text: " " },
          { kind: "broadcast", range: "here" },
          { ...PLAIN, text: " by " },
          { kind: "date", label: "Friday", timestamp: 1_790_000_000 },
        ],
      },
    ];
    const words = draftLinesWords({
      labels: {
        mentions: [{ key: "@ops", kind: "group", target: "S0OPS" }],
        people: new Map([["U0ALICE", { handle: "alice", name: "Alice Ng" }]]),
      },
      lines,
    });
    expect(words).toBe("Visible B for @Alice Ng and @ops in #C0ENG\n• the runbook :tada: @here by Friday");
  });

  it("reads a member with no roster name and no recorded key as its id, the way the chip draws it", () => {
    const words = draftLinesWords({
      labels: { mentions: [], people: new Map() },
      lines: [{ frame: undefined, marker: undefined, runs: [{ kind: "user", userId: "U0BOB" }] }],
    });
    expect(words).toBe("@U0BOB");
  });

  it("never labels a person with a group's key, nor a group with a person's, for the same target", () => {
    const words = draftLinesWords({
      labels: {
        mentions: [
          { key: "@ops", kind: "group", target: "U0BOB" },
          { key: "@seth", kind: "person", target: "S0OPS" },
        ],
        people: new Map(),
      },
      lines: [
        {
          frame: undefined,
          marker: undefined,
          runs: [
            { kind: "user", userId: "U0BOB" },
            { ...PLAIN, text: " " },
            { groupId: "S0OPS", handle: undefined, kind: "usergroup" },
          ],
        },
      ],
    });
    expect(words).toBe("@U0BOB @a group");
  });

  it("draws a person's own id, and a group as a group, never a recorded key spelled as an id", () => {
    const words = draftLinesWords({
      labels: {
        mentions: [
          { key: "＠Ｓ９ＯＴＨＥＲ​", kind: "person", target: "U0BOB" },
          { key: "@U9OTHER\u0085", kind: "group", target: "S0OPS" },
        ],
        people: new Map(),
      },
      lines: [
        {
          frame: undefined,
          marker: undefined,
          runs: [
            { kind: "user", userId: "U0BOB" },
            { ...PLAIN, text: " " },
            { groupId: "S0OPS", handle: undefined, kind: "usergroup" },
          ],
        },
      ],
    });
    expect(words).toBe("@U0BOB @a group");
  });

  it("draws a chip's own id over a short recorded key the register would parse as an id (forty-eighth pass)", () => {
    const words = draftLinesWords({
      labels: { mentions: [{ key: "@U0BOB", kind: "person", target: "U9TARGET" }], people: new Map() },
      lines: [{ frame: undefined, marker: undefined, runs: [{ kind: "user", userId: "U9TARGET" }] }],
    });
    expect(words).toBe("@U9TARGET");
  });

  it("draws a recorded name trimmed of every unseen edge character, its own @ dropped", () => {
    const words = draftLinesWords({
      labels: { mentions: [{ key: "\u0085@ops​", kind: "group", target: "S0OPS" }], people: new Map() },
      lines: [
        { frame: undefined, marker: undefined, runs: [{ groupId: "S0OPS", handle: undefined, kind: "usergroup" }] },
      ],
    });
    expect(words).toBe("@ops");
  });

  it("adds no newline where a break run already parts two lines, as Slack posts them (forty-ninth pass)", () => {
    const line = ({ marker, text }: { marker?: string; text: string }): DraftLine => ({
      frame: undefined,
      marker,
      runs: [{ ...PLAIN, text }],
    });
    const words = draftLinesWords({
      labels: { mentions: [], people: new Map() },
      lines: [
        line({ text: "one\n\n" }),
        line({ text: "two" }),
        line({ marker: "•", text: "item" }),
        line({ text: "\nafter the list" }),
      ],
    });
    expect(words).toBe("one\n\ntwo\n• item\nafter the list");
  });

  it("reads nothing when the draft draws no lines", () => {
    expect(draftLinesWords({ labels: { mentions: [], people: new Map() }, lines: [] })).toBe("");
  });
});

describe("draftGroupLabel — a tagged team reads as its name, the S… id only on hover", () => {
  const NONE = { mentions: [], people: new Map() };

  it("draws the handle the wire carried when the draft recorded no key for the group", () => {
    expect(draftGroupLabel({ groupId: "S0SYN000012", handle: "@platform", labels: NONE })).toEqual({
      text: "platform",
      title: "S0SYN000012",
    });
  });

  it("draws a bare group the draft never recorded as a group, never as its id", () => {
    expect(draftGroupLabel({ groupId: "S0SYN000012", handle: undefined, labels: NONE })).toEqual({
      text: "a group",
      title: "S0SYN000012",
    });
  });

  it("prefers the key the author recorded over the handle the wire carried", () => {
    const labels = { mentions: [{ key: "@dev-platform", kind: "group", target: "S0SYN000012" }], people: new Map() };
    expect(draftGroupLabel({ groupId: "S0SYN000012", handle: "@platform", labels })).toEqual({
      text: "dev-platform",
      title: "S0SYN000012",
    });
  });

  it("falls past a recorded key spelled as an id to the wire's handle", () => {
    const labels = { mentions: [{ key: "@S0SYN000012", kind: "group", target: "S0SYN000012" }], people: new Map() };
    expect(draftGroupLabel({ groupId: "S0SYN000012", handle: "@platform", labels })).toEqual({
      text: "platform",
      title: "S0SYN000012",
    });
  });
});
