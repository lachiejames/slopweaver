/**
 * `BriefingErrors` — the typed failures `src/briefing` authors, and the lines each one prints.
 */
import { describe, expect, it } from "vitest";

import { BriefingErrors, briefingErrorLines } from "../../../briefing/errors.js";

describe("BriefingErrors", () => {
  it("heads a session-start refusal with what the document is not, then one line per issue", () => {
    const error = BriefingErrors.sessionStartDocumentInvalid({ issues: ["  ranking.ranked: Required"] });

    expect(error.code).toBe("SESSION_START_DOCUMENT_INVALID");
    expect(briefingErrorLines({ error })).toEqual([
      "the document is not a `slopweaver session-start --json` run:",
      "  ranking.ranked: Required",
    ]);
  });

  it("keeps each refused card-drop prefix on its own line, joined by `; ` in the message", () => {
    const error = BriefingErrors.cardDropRefused({
      reasons: ['--drop-card-prefix "a" is given twice', '--drop-card-prefix "b" and "c" both match the same card'],
    });

    expect(briefingErrorLines({ error })).toEqual([
      '--drop-card-prefix "a" is given twice',
      '--drop-card-prefix "b" and "c" both match the same card',
    ]);
    expect(error.message).toBe(
      '--drop-card-prefix "a" is given twice; --drop-card-prefix "b" and "c" both match the same card',
    );
  });

  it("names the keep count a sweep would need when rolling overflows earlierToday", () => {
    const error = BriefingErrors.recentRollOverCap({ cap: 12, notes: 14, rolling: 2 });

    expect(error).toEqual({
      cap: 12,
      code: "RECENT_ROLL_OVER_CAP",
      keep: 10,
      message:
        "rolling 2 block(s) would put 14 notes in earlierToday, over the cap of 12. Nothing was written. " +
        "Archive first, keeping the newest: slopweaver briefing archive --form <path> --keep-notes 10",
      notes: 14,
      rolling: 2,
    });
  });

  it("prints a single-message variant as its one line", () => {
    const error = BriefingErrors.openPageOptionsOverCap({ cap: 4, count: 6, label: "the page" });

    expect(error).toEqual({
      cap: 4,
      code: "OPEN_PAGE_OPTIONS_OVER_CAP",
      count: 6,
      label: "the page",
      message: 'open page "the page" carries 6 options, over the cap of 4',
    });
    expect(briefingErrorLines({ error })).toEqual(['open page "the page" carries 6 options, over the cap of 4']);
  });

  it("names every header key a sweep does not set", () => {
    expect(BriefingErrors.formHeaderFieldsRefused({ fields: ["readyIso", "refreshedIso"] }).message).toBe(
      "the header carries `readyIso`, `refreshedIso`, which a sweep does not set. Remove it from the form: the " +
        "render injects the two instants itself and refuses a form that writes them.",
    );
  });
});
