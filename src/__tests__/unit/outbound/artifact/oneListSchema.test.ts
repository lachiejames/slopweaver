import { describe, expect, it } from "vitest";

import { oneListArtifactSchema } from "../../../../outbound/artifact/asMeSchema.js";

const BOUNDS = { cardVisibleMax: 60, maxBullets: 3, maxTrailing: 2 };

/** One run sequence carrying a single text run — the common shape, stated once. */
function runs({ text }: { text: string }) {
  return [{ text, type: "text" }];
}

describe("oneListArtifactSchema", () => {
  it("accepts a lead, a list and a closing line, and keeps all three fields", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: [runs({ text: "one" }), runs({ text: "two" })],
      kind: "one-list",
      lead: runs({ text: "for review:" }),
      trailing: [runs({ text: "3 left" })],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.bullets.length : 0).toBe(2);
    expect(parsed.success ? parsed.data.trailing.length : 0).toBe(1);
  });

  it("accepts a post with no trailing lines at all", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: [runs({ text: "one" })],
      kind: "one-list",
      lead: runs({ text: "for review:" }),
      trailing: [],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.trailing.length : 0).toBe(0);
  });

  it("refuses a post with no dot points, because that shape is a one-card post", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: [],
      kind: "one-list",
      lead: runs({ text: "for review:" }),
      trailing: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("bounds the WHOLE message across all three fields, not each field on its own", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: [runs({ text: "b".repeat(20) }), runs({ text: "c".repeat(20) })],
      kind: "one-list",
      lead: runs({ text: "a".repeat(20) }),
      trailing: [runs({ text: "d" })],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain("61 visible chars, over the 60 cap");
  });

  it("accepts a message sitting exactly ON the whole-message cap", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: [runs({ text: "b".repeat(20) })],
      kind: "one-list",
      lead: runs({ text: "a".repeat(20) }),
      trailing: [runs({ text: "d".repeat(20) })],
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses more dot points than the cap allows", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: [runs({ text: "a" }), runs({ text: "b" }), runs({ text: "c" }), runs({ text: "d" })],
      kind: "one-list",
      lead: runs({ text: "for review:" }),
      trailing: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("counts HEADLINES against the cap, so sub-points under three headlines still fit a three-point list", () => {
    const parsed = oneListArtifactSchema({ ...BOUNDS, cardVisibleMax: 200 }).safeParse({
      bullets: ["a", "a1", "b", "b1", "b2", "c"].map((text) => runs({ text })),
      depths: [0, 1, 0, 1, 1, 0],
      kind: "one-list",
      lead: runs({ text: "for review:" }),
      trailing: [],
    });

    expect(parsed.error).toBe(undefined);
    expect(parsed.data!.depths).toEqual([0, 1, 0, 1, 1, 0]);
  });

  it("still refuses a fourth HEADLINE when depths are declared", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: ["a", "b", "c", "d"].map((text) => runs({ text })),
      depths: [0, 0, 0, 0],
      kind: "one-list",
      lead: runs({ text: "for review:" }),
      trailing: [],
    });

    expect(parsed.error!.issues.map((issue) => issue.message)).toEqual([
      "a list holds 3 dot points, sized on the operator's own roster; a longer one is a slackMe.drip.maxBullets change in profile.json, never a voice-rules grant",
    ]);
  });

  it("refuses depths that do not match the dot points one for one", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: [runs({ text: "a" }), runs({ text: "b" })],
      depths: [0],
      kind: "one-list",
      lead: runs({ text: "for review:" }),
      trailing: [],
    });

    expect(parsed.error!.issues[0]!.message).toBe(
      "depths carries 1 entries for 2 dot points; give each dot point its depth, 0 for a headline and 1 for a sub-point under it",
    );
  });

  it("refuses a sub-point with no headline above it", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: [runs({ text: "a" }), runs({ text: "b" })],
      depths: [1, 0],
      kind: "one-list",
      lead: runs({ text: "for review:" }),
      trailing: [],
    });

    expect(parsed.error!.issues[0]!.path).toEqual(["depths", 0]);
  });

  it("refuses a second level of nesting, since a depth is a headline or a sub-point and nothing deeper", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: [runs({ text: "a" }), runs({ text: "b" })],
      depths: [0, 2],
      kind: "one-list",
      lead: runs({ text: "for review:" }),
      trailing: [],
    });

    expect(parsed.error!.issues[0]!.path).toEqual(["depths", 1]);
  });

  it("refuses a newline smuggled into a dot point, and names the field that holds the breaks", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: [runs({ text: "one\ntwo" })],
      kind: "one-list",
      lead: runs({ text: "for review:" }),
      trailing: [],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain("a bullets entry carries no");
  });

  it("refuses a newline in the lead, and names `lead` rather than `bullets`", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: [runs({ text: "one" })],
      kind: "one-list",
      lead: runs({ text: "for\nreview:" }),
      trailing: [],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.message).toContain("a lead entry carries no");
  });

  it("refuses a key nobody declared, because every form here is strict", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: [runs({ text: "one" })],
      bulletz: [],
      kind: "one-list",
      lead: runs({ text: "for review:" }),
      trailing: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("carries a typed group mention through, which the plain escape hatch could never verify", () => {
    const parsed = oneListArtifactSchema(BOUNDS).safeParse({
      bullets: [runs({ text: "one" })],
      kind: "one-list",
      lead: runs({ text: "for review:" }),
      trailing: [[{ handle: "deploy-master", type: "group" }]],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.trailing[0]![0]!.type : "").toBe("group");
  });
});
