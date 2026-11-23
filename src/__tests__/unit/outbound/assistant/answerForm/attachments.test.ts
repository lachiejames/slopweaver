/*
 * The two file lanes an answer carries: `images` takes picture paths with no count cap, and `documents` takes
 * the markdown and html deliverables up to its own cap, refusing a picture or a format with no lane.
 */
import { describe, expect, it } from "vitest";

import { answerFormSchema } from "../../../../../outbound/assistant/answerForm.js";
import { ANSWER_DOCUMENTS_MAX } from "../../../../../outbound/assistant/contentLimits.js";
import { VALID_ANSWER_CONVERSATION } from "./fixtures.js";

describe("images — paths only, and how many is the composer's judgement", () => {
  it("answer arm carries images", () => {
    const withImages = { ...VALID_ANSWER_CONVERSATION, images: ["/tmp/a.png", "/tmp/b.png"] };

    const parsed = answerFormSchema.safeParse(withImages);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.kind === "answer" ? parsed.data.images : undefined).toEqual([
      "/tmp/a.png",
      "/tmp/b.png",
    ]);
  });

  // How many pictures is the composer's judgement, so the door never refuses on count.
  it("accepts ELEVEN images, one per control an ISO answer names — there is no count cap", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `/tmp/${String(i)}.png`);

    const parsed = answerFormSchema.parse({ ...VALID_ANSWER_CONVERSATION, images: eleven });

    expect(parsed).toMatchObject({ images: eleven, kind: "answer" });
  });

  it("accepts three images — the 'a few' the old two-image cap refused", () => {
    const three = ["/tmp/a.png", "/tmp/b.png", "/tmp/c.png"];

    expect(answerFormSchema.safeParse({ ...VALID_ANSWER_CONVERSATION, images: three }).success).toBe(true);
    expect(answerFormSchema.parse({ ...VALID_ANSWER_CONVERSATION, images: three })).toMatchObject({ images: three });
  });

  it("still refuses an empty image path, count aside", () => {
    expect(answerFormSchema.safeParse({ ...VALID_ANSWER_CONVERSATION, images: ["/tmp/a.png", ""] }).success).toBe(
      false,
    );
  });

  it("defaults to no images when the field is omitted", () => {
    const { images: _images, ...withoutImages } = VALID_ANSWER_CONVERSATION;

    const parsed = answerFormSchema.safeParse(withoutImages);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.kind === "answer" ? parsed.data.images : undefined).toEqual([]);
  });
});

describe("documents — the DELIVERABLE lane, so a file the ask wanted has a way through the door", () => {
  it("carries a markdown path, which is what the owner asked to receive", () => {
    const withDocuments = { ...VALID_ANSWER_CONVERSATION, documents: ["/tmp/iso-27001.md"] };

    const parsed = answerFormSchema.safeParse(withDocuments);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.kind === "answer" ? parsed.data.documents : undefined).toEqual([
      "/tmp/iso-27001.md",
    ]);
  });

  it("carries the rendered html second", () => {
    const withBoth = { ...VALID_ANSWER_CONVERSATION, documents: ["/tmp/iso.md", "/tmp/iso.html"] };

    const parsed = answerFormSchema.safeParse(withBoth);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.kind === "answer" ? parsed.data.documents : undefined).toEqual([
      "/tmp/iso.md",
      "/tmp/iso.html",
    ]);
  });

  it("REFUSES a picture, which belongs in the other lane", () => {
    const withImage = { ...VALID_ANSWER_CONVERSATION, documents: ["/tmp/shot.png"] };

    const parsed = answerFormSchema.safeParse(withImage);

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("images");
  });

  it("REFUSES a format with no lane at all", () => {
    expect(answerFormSchema.safeParse({ ...VALID_ANSWER_CONVERSATION, documents: ["/tmp/export.zip"] }).success).toBe(
      false,
    );
  });

  it(`accepts exactly ${String(ANSWER_DOCUMENTS_MAX)} documents`, () => {
    const atCap = {
      ...VALID_ANSWER_CONVERSATION,
      documents: Array.from({ length: ANSWER_DOCUMENTS_MAX }, (_, i) => `/tmp/${String(i)}.md`),
    };

    expect(answerFormSchema.safeParse(atCap).success).toBe(true);
  });

  it(`REFUSES ${String(ANSWER_DOCUMENTS_MAX + 1)} documents`, () => {
    const overCap = {
      ...VALID_ANSWER_CONVERSATION,
      documents: Array.from({ length: ANSWER_DOCUMENTS_MAX + 1 }, (_, i) => `/tmp/${String(i)}.md`),
    };

    expect(answerFormSchema.safeParse(overCap).success).toBe(false);
  });

  it("defaults to no documents when the field is omitted, so every answer composed before this lane existed still parses", () => {
    const parsed = answerFormSchema.safeParse(VALID_ANSWER_CONVERSATION);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.kind === "answer" ? parsed.data.documents : undefined).toEqual([]);
  });
});
