/**
 * What one `github bump-drive` pass says for itself.
 *
 * These lines are the only evidence an unattended firing leaves anywhere a person looks, so the case that
 * `failed` leads the report is a behaviour assertion rather than a formatting one.
 */
import { describe, expect, it } from "vitest";

import {
  type BumpDriveOutcome,
  bumpDriveDocument,
  bumpDriveLines,
} from "../../../../../cli/commands/github/bumpDriveReport.js";

/** One outcome, with only the fields a case is about stated. */
function outcome(over: Partial<BumpDriveOutcome> = {}): BumpDriveOutcome {
  return {
    act: "enqueue",
    detail: "enqueued it, and recorded it on the autonomy ledger",
    number: 951,
    outcome: "acted",
    repoSlug: "acme/widgets",
    signal: "bot-author",
    url: "https://github.com/acme/widgets/pull/951",
    ...over,
  };
}

describe("bumpDriveLines", () => {
  it("leads with how many bumps were found against how many pull requests are open", () => {
    const lines = bumpDriveLines({ notes: [], openCount: 24, outcomes: [outcome()] });

    expect(lines[0]).toBe("1 dependency bump(s) of 24 open pull request(s)");
  });

  it("puts the failures first, because a pass that undrafted and then could not queue needs a person", () => {
    const lines = bumpDriveLines({
      notes: [],
      openCount: 3,
      outcomes: [
        outcome({ number: 1 }),
        outcome({
          act: "undraft-and-enqueue",
          detail: "undrafted, but `github enqueue` refused it",
          number: 2,
          outcome: "failed",
        }),
      ],
    });

    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("failed — 1");
    expect(lines[3]).toBe("  #2 undraft-and-enqueue (bot-author) — undrafted, but `github enqueue` refused it");
    expect(lines[4]).toBe("");
    expect(lines[5]).toBe("acted — 1");
  });

  it("omits a group nothing fell into, rather than printing an empty heading", () => {
    const lines = bumpDriveLines({ notes: [], openCount: 1, outcomes: [outcome()] });

    expect(lines.filter((line) => line.startsWith("failed"))).toEqual([]);
    expect(lines.filter((line) => line.startsWith("skipped"))).toEqual([]);
  });

  it("names the act and the signal on every row, so a title-only selection is visible", () => {
    const lines = bumpDriveLines({
      notes: [],
      openCount: 1,
      outcomes: [
        outcome({
          act: "seat",
          detail: "registered land-acme-widgets-1-abc on the one board",
          number: 1,
          signal: "title",
        }),
      ],
    });

    expect(lines).toContain("  #1 seat (title) — registered land-acme-widgets-1-abc on the one board");
  });

  it("says so in one line when the read found no bumps at all, and still gives the denominator", () => {
    expect(bumpDriveLines({ notes: [], openCount: 24, outcomes: [] })).toEqual([
      "no dependency bumps among the 24 open pull request(s)",
    ]);
  });

  it("closes with every note, even when the ladder found nothing, so a failed close read is never silent", () => {
    expect(
      bumpDriveLines({
        notes: ["acme/widgets: closed nothing superseded — Bad credentials"],
        openCount: 2,
        outcomes: [],
      }),
    ).toEqual([
      "no dependency bumps among the 2 open pull request(s)",
      "",
      "notes — 1",
      "  acme/widgets: closed nothing superseded — Bad credentials",
    ]);
  });
});

describe("bumpDriveDocument", () => {
  it("carries the selection and the dry-run flag beside the acts, so a dry pass is never read as a real one", () => {
    const document = bumpDriveDocument({
      dryRun: true,
      notes: [
        "acme/widgets: 0 open bump(s) of the owner's, 0 changing only dependency files, of 0 open pull request(s) read whole; 0 superseded",
      ],
      nowIso: "2026-09-20T02:00:00.000Z",
      openCount: 24,
      outcomes: [outcome({ detail: "would enqueue: every one of the six tests passed", outcome: "would-act" })],
      repos: ["lachiejames/slopweaver"],
    });

    expect(document.dryRun).toBe(true);
    expect(document.openCount).toBe(24);
    expect(document.repos).toEqual(["lachiejames/slopweaver"]);
    expect(document.nowIso).toBe("2026-09-20T02:00:00.000Z");
    expect(document.outcomes[0]!.outcome).toBe("would-act");
    expect(document.notes).toEqual([
      "acme/widgets: 0 open bump(s) of the owner's, 0 changing only dependency files, of 0 open pull request(s) read whole; 0 superseded",
    ]);
  });
});
