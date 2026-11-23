import { describe, expect, it } from "vitest";

import {
  NO_FOLD_BULLET_VISIBLE_MAX,
  NO_FOLD_BULLETS_MAX,
  NO_FOLD_TRAILING_MAX,
  NO_FOLD_VISIBLE_MAX,
  noFoldArtifactSchema,
  noFoldVisibleLength,
} from "../../../../outbound/artifact/noFoldSchema.js";
import type { NoFoldArtifact } from "../../../../outbound/artifact/types.js";

/** The shape the policy DM is cut on: an action line, dot points, and one line after them. */
function form(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bullets: [[{ text: "Code of Conduct", type: "text" }]],
    kind: "no-fold",
    lead: [
      { person: "ada", type: "mention" },
      { text: " ", type: "text" },
      { label: "Open your Vanta security tasks", type: "link", url: "https://vanta.invalid/onboarding" },
      { text: " and press the accept button.", type: "text" },
    ],
    trailing: [[{ text: "Tracked per person for ISO 27001.", type: "text" }]],
    ...over,
  };
}

describe("noFoldArtifactSchema", () => {
  it("accepts the three-region shape and keeps every region", () => {
    const parsed = noFoldArtifactSchema.safeParse(form());

    expect(parsed.success).toBe(true);
    const artifact = parsed.data as NoFoldArtifact;
    expect(artifact.kind).toBe("no-fold");
    expect(artifact.lead.length).toBe(4);
    expect(artifact.bullets.length).toBe(1);
    expect(artifact.trailing.length).toBe(1);
  });

  it("defaults bullets and trailing to empty, so one lead line is a valid message", () => {
    const parsed = noFoldArtifactSchema.safeParse({
      kind: "no-fold",
      lead: [{ text: "One line.", type: "text" }],
    });

    expect(parsed.success).toBe(true);
    expect((parsed.data as NoFoldArtifact).bullets).toEqual([]);
    expect((parsed.data as NoFoldArtifact).trailing).toEqual([]);
  });

  it("REFUSES a key it does not declare, rather than dropping it", () => {
    const parsed = noFoldArtifactSchema.safeParse(form({ detail: [] }));

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toContain("detail");
  });

  it("REFUSES a citation run — the chip's footnote lives below a fold this form does not have", () => {
    const parsed = noFoldArtifactSchema.safeParse(form({ lead: [{ citationId: "c1", type: "citation" }] }));

    expect(parsed.success).toBe(false);
  });

  it("REFUSES a broadcast run — this form addresses one person, never a room", () => {
    const parsed = noFoldArtifactSchema.safeParse(form({ lead: [{ range: "here", type: "broadcast" }] }));

    expect(parsed.success).toBe(false);
  });

  it("REFUSES a group run for the same reason", () => {
    const parsed = noFoldArtifactSchema.safeParse(form({ lead: [{ handle: "engineers", type: "group" }] }));

    expect(parsed.success).toBe(false);
  });

  it("does NOT convert a literal <!here> into a broadcast run — it refuses it as raw markup", () => {
    const parsed = noFoldArtifactSchema.safeParse(form({ lead: [{ text: "hey <!here> read this", type: "text" }] }));

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toContain("<!here>");
  });

  it("DOES convert a raw <@U…> into a mention run, because this form can hold one", () => {
    const parsed = noFoldArtifactSchema.safeParse(form({ lead: [{ text: "hi <@U0SYN000001> there", type: "text" }] }));

    expect(parsed.success).toBe(true);
    const runs = (parsed.data as NoFoldArtifact).lead;
    expect(runs[1]).toEqual({ person: "U0SYN000001", type: "mention" });
  });

  it("REFUSES an embedded newline, because the three regions ARE the line structure", () => {
    const parsed = noFoldArtifactSchema.safeParse(form({ lead: [{ text: "one\ntwo", type: "text" }] }));

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toContain("a no-fold line carries no");
  });

  it("REFUSES a newline smuggled into a LINK LABEL, not only into a text run", () => {
    const parsed = noFoldArtifactSchema.safeParse(
      form({ lead: [{ label: "open\nthis", type: "link", url: "https://vanta.invalid/x" }] }),
    );

    expect(parsed.success).toBe(false);
  });

  it("REFUSES a dot point longer than one line, naming the cap", () => {
    const parsed = noFoldArtifactSchema.safeParse(
      form({ bullets: [[{ text: "x".repeat(NO_FOLD_BULLET_VISIBLE_MAX + 1), type: "text" }]] }),
    );

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toContain("dot point");
  });

  it("REFUSES more dot points than the cap", () => {
    const bullets = Array.from({ length: NO_FOLD_BULLETS_MAX + 1 }, () => [{ text: "a", type: "text" }]);
    const parsed = noFoldArtifactSchema.safeParse(form({ bullets }));

    expect(parsed.success).toBe(false);
  });

  it("REFUSES more trailing lines than the cap", () => {
    const trailing = Array.from({ length: NO_FOLD_TRAILING_MAX + 1 }, () => [{ text: "a", type: "text" }]);
    const parsed = noFoldArtifactSchema.safeParse(form({ trailing }));

    expect(parsed.success).toBe(false);
  });

  it("REFUSES a message over the whole-message cap and names the form that has room", () => {
    const parsed = noFoldArtifactSchema.safeParse(
      form({ lead: [{ text: "x".repeat(NO_FOLD_VISIBLE_MAX + 1), type: "text" }] }),
    );

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.message).toContain('send it as `{"kind":"update"}`');
  });

  it("accepts a message EXACTLY at the cap — the boundary is inclusive", () => {
    const parsed = noFoldArtifactSchema.safeParse({
      kind: "no-fold",
      lead: [{ text: "x".repeat(NO_FOLD_VISIBLE_MAX), type: "text" }],
    });

    expect(parsed.success).toBe(true);
  });
});

describe("noFoldVisibleLength", () => {
  it("counts a link's LABEL and not its URL, because only the label is seen", () => {
    const artifact = noFoldArtifactSchema.safeParse({
      kind: "no-fold",
      lead: [{ label: "Open it", type: "link", url: "https://vanta.invalid/a/very/long/path/nobody/reads" }],
    }).data as NoFoldArtifact;

    expect(noFoldVisibleLength({ artifact })).toBe("Open it".length);
  });

  it("sums every region, so splitting a message across lines does not buy width", () => {
    const artifact = noFoldArtifactSchema.safeParse({
      bullets: [[{ text: "bb", type: "text" }]],
      kind: "no-fold",
      lead: [{ text: "aaa", type: "text" }],
      trailing: [[{ text: "c", type: "text" }]],
    }).data as NoFoldArtifact;

    expect(noFoldVisibleLength({ artifact })).toBe(6);
  });
});
