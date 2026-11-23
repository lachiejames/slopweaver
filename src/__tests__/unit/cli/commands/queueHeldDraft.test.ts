/*
 * Reading a held draft back out of the log, driven directly rather than through `queue release`.
 *
 * Until the split these parsers were private and reachable only through the verb, so the one thing they
 * exist to get right — a valid answer form must not be refused for carrying the reserved keys this codebase
 * itself put on it — was asserted only as a side effect of a dry-run release succeeding.
 *
 * Every draft here is a shape the answer schema really accepts, so a case that stops parsing reddens rather
 * than quietly agreeing with a parser that stopped working.
 */
import { describe, expect, it } from "vitest";

import { decodeHeldUploads, parseHeldAnswer, replacementDraft } from "../../../../cli/commands/queue/queueHeldDraft.js";
import { HELD_DOCUMENTS_KEY, HELD_UPLOADS_KEY } from "../../../../live/turn/heldUploads.js";

/** A held draft in the answer-form shape, grounded in context alone so it needs no live source. */
const ANSWER: Readonly<Record<string, unknown>> = {
  body: [],
  citations: [],
  grounding: {
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else to check" },
      premiseChecks: [],
      read: [],
    },
    kind: "conversation",
    provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
    reason: "already known from context, no live check needed",
  },
  images: [],
  kind: "answer",
  lead: "The connector polls by updated timestamp.",
};

const ONE_UPLOAD = { bytesBase64: Buffer.from("hello").toString("base64"), filename: "shot.png" };

describe("the fixture these cases stand on", () => {
  it("is a draft the answer schema really accepts, so no case below is vacuous", () => {
    expect(parseHeldAnswer({ raw: ANSWER })!.answer.lead).toBe("The connector polls by updated timestamp.");
  });
});

describe("parseHeldAnswer", () => {
  it("takes the reserved upload keys OUT before validating, so a valid answer is not refused for them", () => {
    const parsed = parseHeldAnswer({
      raw: { ...ANSWER, [HELD_DOCUMENTS_KEY]: [], [HELD_UPLOADS_KEY]: [ONE_UPLOAD] },
    })!;
    expect(parsed.answer.lead).toBe("The connector polls by updated timestamp.");
    expect(parsed.heldUploads).toEqual([ONE_UPLOAD]);
    expect(parsed.heldDocuments).toEqual([]);
  });

  it("separates the two reserved lanes rather than folding them into one list", () => {
    const parsed = parseHeldAnswer({
      raw: { ...ANSWER, [HELD_DOCUMENTS_KEY]: [ONE_UPLOAD], [HELD_UPLOADS_KEY]: [] },
    })!;
    expect(parsed.heldDocuments).toEqual([ONE_UPLOAD]);
    expect(parsed.heldUploads).toEqual([]);
  });

  it("drops a locked entry that did not survive the JSON round trip, keeping the ones that did", () => {
    const parsed = parseHeldAnswer({
      raw: { ...ANSWER, [HELD_UPLOADS_KEY]: [ONE_UPLOAD, { filename: "lost.png" }, "not-a-record"] },
    })!;
    expect(parsed.heldUploads).toEqual([ONE_UPLOAD]);
  });

  it("reads a reserved key that is not a list as no attachments at all", () => {
    expect(parseHeldAnswer({ raw: { ...ANSWER, [HELD_UPLOADS_KEY]: { filename: "shot.png" } } })!.heldUploads).toEqual(
      [],
    );
  });

  it("answers undefined for a legacy UpdateArtifact draft, which is how the verb picks the other path", () => {
    expect(parseHeldAnswer({ raw: { kind: "update", tldr: "we render rich_text" } })).toBe(undefined);
  });

  it("answers undefined for an answer-shaped draft carrying an unknown key of its own", () => {
    expect(parseHeldAnswer({ raw: { ...ANSWER, notAField: 1 } })).toBe(undefined);
  });
});

describe("decodeHeldUploads", () => {
  it("decodes the locked bytes back to exactly what was stored", () => {
    const decoded = decodeHeldUploads({ heldUploads: [ONE_UPLOAD] });
    expect(decoded.length).toBe(1);
    expect(decoded[0]!.filename).toBe("shot.png");
    expect(Buffer.from(decoded[0]!.bytes).toString("utf8")).toBe("hello");
  });

  it("answers an empty list for no attachments, rather than one empty attachment", () => {
    expect(decodeHeldUploads({ heldUploads: [] })).toEqual([]);
  });
});

describe("replacementDraft", () => {
  it("answers undefined for no --form, which is the ordinary release of the stored draft", async () => {
    expect(await replacementDraft({ form: undefined })).toBe(undefined);
    expect(await replacementDraft({ form: "" })).toBe(undefined);
  });

  it("names the parse failure rather than falling back to the stored draft", async () => {
    const outcome = (await replacementDraft({ form: "{not json" })) as { readonly failure: string };
    expect(outcome.failure).toContain("--form is not valid JSON");
  });

  it("refuses a JSON array, because a form is an object", async () => {
    const outcome = (await replacementDraft({ form: "[]" })) as { readonly failure: string };
    expect(outcome.failure).toContain("must be a JSON object");
  });

  it("carries a parsed object through as the replacement draft", async () => {
    const outcome = (await replacementDraft({ form: JSON.stringify(ANSWER) })) as {
      readonly draft: Readonly<Record<string, unknown>>;
    };
    expect(outcome.draft).toEqual(ANSWER);
  });
});
