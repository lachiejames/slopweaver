import { describe, expect, it } from "vitest";

import { ANSWER, COVERAGE, EMPTY_ANSWER, MENTION, PROVENANCE } from "./fixtures.js";
import { drive, fakeQuery, type Recorded, recordingPoster } from "./harness.js";

describe("runTurn content", () => {
  it("asks the world model exactly the text the transport handed it, with no second stripping pass", async () => {
    let asked = "";
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      provenance: PROVENANCE,
      query: async ({ question }) => {
        asked = question;
        return { answer: ANSWER, completionDetail: "done", coverage: COVERAGE };
      },
    });
    expect(asked).toBe("what did we decide about the renderer?");
  });

  it("posts the answer's own lead", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: [] }),
    });
    expect(log.find((entry) => entry.kind === "post-answer")!.lead).toBe("We render rich_text.");
  });

  it("posts the honest empty answer when the corpus matched nothing", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      provenance: PROVENANCE,
      query: fakeQuery({ answer: EMPTY_ANSWER, phases: [] }),
    });
    expect(log.find((entry) => entry.kind === "post-answer")!.lead).toBe(
      "No records in the world model matched that question.",
    );
  });
});
