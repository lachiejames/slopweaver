/**
 * The pure core of `briefing render`, driven with no projection at all: the form's JSON, the stamps the run
 * injects and refuses from a composer, the image-path seam, and the render-then-check round trip.
 */
import { describe, expect, it } from "vitest";
import { NO_OWNER_BELIEFS } from "../../../../../briefing/ownerBeliefs.js";
import { BriefingCommandErrors } from "../../../../../cli/commands/briefing/errors.js";
import { formIssueLine } from "../../../../../cli/commands/briefing/refusedPage.js";
import {
  checkRenderedBriefing,
  parseBriefingForm,
  renderBriefingPage,
} from "../../../../../cli/commands/briefing/renderCore.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { renderBriefing } from "../../../../../outbound/briefing/render.js";
import type { BriefingCard, BriefingContent, BriefingForm } from "../../../../../outbound/briefing/types.js";

/** The image reader seam, typed off the function under test so the fake cannot drift from it. */
type ReadImageDataUri = Parameters<typeof parseBriefingForm>[0]["readImageDataUri"];

/** A fixed instant, so a card's rendered age is the same on every run of this suite. */
const NOW_ISO = "2026-09-12T00:00:00Z";

/** The two instants the run stamps into the header. */
const STAMPS = { readyIso: "2026-09-02T01:40:00.000Z", refreshedIso: "2026-09-02T01:12:00.000Z" };

/** A tiny well-formed PNG `data:` URI the schema admits. */
const DATA = "data:image/png;base64,iVBORw0KGgo=";

/** One text run, the shape most cells are. */
function text({ value }: { value: string }): BriefingContent {
  return [{ kind: "text", text: value }];
}

/** The `briefing/render/harness.ts` card, plus the `detail` fold the schema requires of a card with no subject page. */
const CARD: BriefingCard = {
  detail: {
    blocks: [{ content: text({ value: "The draft is three short paragraphs." }), kind: "para" }],
    summary: "What the draft says",
  },
  ifSilent: text({ value: "The draft stays unsent." }),
  lean: text({ value: "A." }),
  options: [
    { letter: "A", text: "Send it as written." },
    { letter: "B", text: "Send it with edits." },
  ],
  premise: { kind: "composed", readIso: "2026-09-11T21:18:59Z" },
  question: "Are you happy with the draft?",
  readiness: { state: "ready" },
  what: text({ value: "The draft adds a template and a doc. It also adds a check that only reports." }),
  whyYou: text({ value: "It is a post to the team under your name." }),
};

/** What a composer writes: everything but the stamps and the sections the schema defaults. */
type Composed = Omit<BriefingForm, "autonomy" | "handSteps" | "ownerBeliefs" | "header" | "reactNow"> & {
  header: Omit<BriefingForm["header"], "readyIso" | "refreshedIso">;
  reactNow: Omit<BriefingForm["reactNow"], "openArtifacts">;
};

const COMPOSED: Composed = {
  alignment: {
    headline: text({ value: "2 of 3 live sessions are on the board's top 5." }),
    intake: text({ value: "Owner turns: 4 read across 1 supervisor session(s), all witnessed." }),
  },
  awaiting: [],
  earlierToday: { notes: [{ headline: text({ value: "A quiet sweep." }) }], summary: "earlier today, in order" },
  header: {
    handoff: "handoff-9012",
    lede: text({ value: "One thing needs your word." }),
    model: "opus",
    pinnedAt: "23:57",
    sleeping: false,
    workspace: "ws:598",
  },
  history: [{ notes: [{ headline: text({ value: "The gate landed." }) }], summary: "history: 29 Aug" }],
  reactNow: { meFacing: [], teamFacing: [CARD] },
  recent: [{ headline: text({ value: "The render verb is built." }) }],
};

/** The form {@link COMPOSED} parses to: the stamps injected and every defaulted section at its default. */
const FORM: BriefingForm = {
  ...COMPOSED,
  autonomy: { notShown: 0, rows: [] },
  handSteps: { notShown: 0, rows: [], unreadable: 0 },
  header: { ...COMPOSED.header, ...STAMPS },
  ownerBeliefs: NO_OWNER_BELIEFS,
  reactNow: { ...COMPOSED.reactNow, openArtifacts: [] },
};

/** A reader that records every path it is asked for and answers each with {@link DATA}. */
function recordingReader(): { calls: unknown[]; read: ReadImageDataUri } {
  const calls: unknown[] = [];
  const read: ReadImageDataUri = (args) => {
    calls.push(args);
    return ok(DATA);
  };
  return { calls, read };
}

/** Parse a raw form with no projection supplied and the fixed stamps. */
function parse({ raw, readImageDataUri }: { raw: string; readImageDataUri: ReadImageDataUri }) {
  return parseBriefingForm({
    autonomy: undefined,
    freshness: undefined,
    handSteps: undefined,
    narrative: undefined,
    nothingStale: undefined,
    openArtifacts: undefined,
    openPageCards: undefined,
    openPrs: undefined,
    ownerBeliefs: undefined,
    quiz: undefined,
    raw,
    readImageDataUri,
    stamps: STAMPS,
    yourList: undefined,
  });
}

/** What `JSON.parse` throws for a raw text, captured so the expected error is built from the real cause. */
function jsonParseFailure({ raw }: { raw: string }): unknown {
  try {
    JSON.parse(raw);
  } catch (error: unknown) {
    return error;
  }
  throw new Error(`expected ${JSON.stringify(raw)} not to parse`);
}

/** {@link COMPOSED} with one card whose fold carries two image blocks naming the same path. */
const COMPOSED_WITH_IMAGES = {
  ...COMPOSED,
  reactNow: {
    meFacing: [],
    teamFacing: [
      {
        ...CARD,
        detail: {
          blocks: [
            { alt: "the draft, first half", kind: "image", path: "shots/draft.png" },
            { alt: "the draft, second half", kind: "image", path: "shots/draft.png" },
          ],
          summary: "Two screenshots of the draft",
        },
      },
    ],
  },
};

describe("parseBriefingForm", () => {
  it("DOCUMENT_NOT_JSON: refuses text that is not JSON, naming the parser's own reason", () => {
    const { calls, read } = recordingReader();

    const error = unwrapErr(parse({ raw: "", readImageDataUri: read }));

    expect(error).toEqual(
      BriefingCommandErrors.documentNotJson({ cause: jsonParseFailure({ raw: "" }), document: "form" }),
    );
    expect(error.code).toBe("DOCUMENT_NOT_JSON");
    expect(error.message).toBe("the form is not valid JSON: Unexpected end of JSON input");
    expect(calls).toEqual([]);
  });

  it("parses a form with no image path into the complete form, stamps injected, and never reads an image", () => {
    const { calls, read } = recordingReader();

    const parsed = unwrap(parse({ raw: JSON.stringify(COMPOSED), readImageDataUri: read }));

    expect(parsed).toEqual({ foldedPages: [], form: FORM });
    expect(calls).toEqual([]);
  });

  it("reads a path two image blocks share once, and gives both blocks its data", () => {
    const { calls, read } = recordingReader();

    const parsed = unwrap(parse({ raw: JSON.stringify(COMPOSED_WITH_IMAGES), readImageDataUri: read }));

    expect(calls).toEqual([{ path: "shots/draft.png" }]);
    expect(parsed.form.reactNow.teamFacing[0]!.detail!.blocks).toEqual([
      { alt: "the draft, first half", data: DATA, kind: "image" },
      { alt: "the draft, second half", data: DATA, kind: "image" },
    ]);
  });

  it("FORM_REJECTED: refuses an image the reader cannot read, naming the block's path", () => {
    const read: ReadImageDataUri = () => err(["no such file"]);

    const error = unwrapErr(parse({ raw: JSON.stringify(COMPOSED_WITH_IMAGES), readImageDataUri: read }));

    expect(error).toEqual(
      BriefingCommandErrors.formRejected({ reasons: ["reactNow.teamFacing.0.detail.blocks.0.path: no such file"] }),
    );
    expect(error.code).toBe("FORM_REJECTED");
    expect(error.message).toBe("reactNow.teamFacing.0.detail.blocks.0.path: no such file");
  });

  it("STAMPS_COMPOSED: refuses a header that writes all three stamps, naming every one", () => {
    const { read } = recordingReader();
    const authored = {
      ...COMPOSED,
      header: { ...COMPOSED.header, ...STAMPS, staleSnapshots: [] },
    };

    const error = unwrapErr(parse({ raw: JSON.stringify(authored), readImageDataUri: read }));

    expect(error).toEqual(
      BriefingCommandErrors.stampsComposed({ fields: ["refreshedIso", "readyIso", "staleSnapshots"] }),
    );
    expect(error.code).toBe("STAMPS_COMPOSED");
    expect(error.message).toBe(
      "the form writes refreshedIso and readyIso and staleSnapshots itself. The instants come off the machine " +
        "clock and the session-start run behind the page, and how stale a half of the page is comes off the " +
        "same two — never from a composer. Drop them; the verb stamps them.",
    );
  });
});

describe("formIssueLine", () => {
  it("leads a field's rejection with its dotted path", () => {
    expect(formIssueLine({ issue: { message: "Required", path: ["header", "lede", 0] } })).toBe(
      "header.lede.0: Required",
    );
  });

  it("leads a rejection with an empty path by the word form, never by nothing", () => {
    expect(formIssueLine({ issue: { message: "Expected object", path: [] } })).toBe("form: Expected object");
  });
});

describe("renderBriefingPage and checkRenderedBriefing", () => {
  it("renders the form with the shipped renderer and passes the check, which returns the entire page", () => {
    const html = renderBriefingPage({ form: FORM });

    const checked = checkRenderedBriefing({
      applyBareRefs: true,
      applyFraming: true,
      applyVoice: true,
      html,
      nowIso: NOW_ISO,
      projected: false,
      rules: [],
    });

    expect(html).toBe(renderBriefing({ form: FORM }));
    expect(unwrap(checked)).toBe(html);
  });
});
