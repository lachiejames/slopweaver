import { describe, expect, it } from "vitest";

import { huddleCensus } from "../../../atlas/slack.js";

describe("huddleCensus", () => {
  it("counts huddles and splits them by whether the notes named a transcript", () => {
    const census = huddleCensus({
      huddles: [
        { hasWords: true, transcriptFileId: "F1", tsIso: "2026-08-28T02:28:34.000Z" },
        { hasWords: false, transcriptFileId: "F2", tsIso: "2026-01-02T00:00:00.000Z" },
        { hasWords: false, transcriptFileId: undefined, tsIso: "2026-05-05T00:00:00.000Z" },
      ],
    });
    expect(census.total).toBe(3);
    expect(census.withTranscript).toBe(2);
    expect(census.withoutTranscript).toBe(1);
  });

  it("counts words in the corpus separately from a transcript the notes merely named", () => {
    const census = huddleCensus({
      huddles: [
        { hasWords: true, transcriptFileId: "F1", tsIso: "2026-08-28T02:28:34.000Z" },
        { hasWords: false, transcriptFileId: "F2", tsIso: "2026-01-02T00:00:00.000Z" },
        { hasWords: false, transcriptFileId: undefined, tsIso: "2026-05-05T00:00:00.000Z" },
      ],
    });
    expect(census.withTranscript).toBe(2);
    expect(census.withWords).toBe(1);
  });

  it("reports the window as the oldest and newest huddle, not as insertion order", () => {
    const census = huddleCensus({
      huddles: [
        { hasWords: true, transcriptFileId: "F1", tsIso: "2026-08-28T02:28:34.000Z" },
        { hasWords: false, transcriptFileId: "F2", tsIso: "2026-01-02T00:00:00.000Z" },
      ],
    });
    expect(census.earliestIso).toBe("2026-01-02T00:00:00.000Z");
    expect(census.latestIso).toBe("2026-08-28T02:28:34.000Z");
  });

  it("leaves the window unset when no huddle carried a usable timestamp", () => {
    const census = huddleCensus({ huddles: [{ hasWords: false, transcriptFileId: "F1", tsIso: "" }] });
    expect(census.earliestIso).toBe(undefined);
    expect(census.latestIso).toBe(undefined);
    expect(census.total).toBe(1);
  });

  it("reports an empty corpus as zero rather than refusing", () => {
    expect(huddleCensus({ huddles: [] }).total).toBe(0);
  });
});
