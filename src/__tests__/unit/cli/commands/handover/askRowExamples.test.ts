/**
 * `handover register --example` / `--example-gap`: the concrete scenes a card leads with, or the one line saying
 * why the row cannot support a truthful one.
 *
 * The round trip is the property: the console reads the scenes off `parseHandoverDoc`, so a block the writer puts
 * down and the parser never reads would publish a card with no example over a row that recorded one.
 */
import { describe, expect, it } from "vitest";

import { askRowText } from "../../../../../cli/commands/handover/askRowText.js";
import type { AskExampleSet } from "../../../../../handover/askExamples.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";

const SCENE_ONE =
  'You open the Queue between two calls and a card says "the mirror skipped the evidence files: copy them?"';
const SCENE_ONE_WHOLE = `${SCENE_ONE} Would you rather it carried them?`;
const SCENE_TWO = "You are mid-audit and the auditor asks for a file the mirror never held. Should it hold it?";

const written = ({ examples }: { examples: AskExampleSet | undefined }): string =>
  askRowText({
    anchor: "talk:2026-10-04T03:02:00.000Z",
    ask: "Should the mirror carry the evidence files themselves?",
    askedIso: "2026-10-04T03:02:00.000Z",
    branch: undefined,
    checkedIso: "2026-10-04T03:05:00.000Z",
    dispatch: false,
    examples,
    finding: undefined,
    priority: undefined,
    repo: undefined,
    shape: undefined,
    slug: "mirror-evidence-files",
  });

const parsed = ({ text }: { text: string }): ReturnType<typeof parseHandoverDoc> =>
  parseHandoverDoc({ path: "/state/handovers/mirror-evidence-files.md", text });

describe("askRowText — examples", () => {
  it("round-trips numbered scenes through the board's own parser, in order, quotes and colons intact", () => {
    const doc = parsed({ text: written({ examples: { examples: [SCENE_ONE_WHOLE, SCENE_TWO], kind: "examples" } }) });

    expect(doc.examples).toEqual([SCENE_ONE_WHOLE, SCENE_TWO]);
    expect(doc.exampleGap).toBeUndefined();
  });

  it("round-trips a gap as the one line, with no scenes", () => {
    const doc = parsed({ text: written({ examples: { gap: "the row records no event they saw", kind: "gap" } }) });

    expect(doc.exampleGap).toBe("the row records no event they saw");
    expect(doc.examples).toEqual([]);
  });

  it("writes neither key for a row that heads no card of the owner's", () => {
    const text = written({ examples: undefined });

    expect(text).not.toContain("examples:");
    expect(text).not.toContain("exampleGap:");
    expect(parsed({ text }).examples).toEqual([]);
  });
});
