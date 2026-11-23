import { describe, expect, it } from "vitest";

import { landingDetailLines } from "../../../../../cli/commands/github/landingDetailReport.js";
import { landingRowFake } from "../../../../landingRowFake.js";

const RED = landingRowFake({
  action: "spawn-ci",
  approvedBy: ["alice"],
  ci: "red",
  ciFailure: { kind: "red", required: true },
  dispatch: { kind: "act", verdict: "rebase-and-fix", why: "required CI is red" },
  failingChecks: [
    {
      kind: "check-run",
      name: "unit",
      required: true,
      state: "failed",
      url: "https://github.com/acme/widgets/actions/runs/1/job/2",
    },
    { kind: "check-run", name: "vercel", required: false, state: "failed", url: undefined },
  ],
  residue: ["a row residue line"],
});

describe("landingDetailLines", () => {
  it("prints the fact line first, then the URL, then the row whole", () => {
    const lines = landingDetailLines({ evidence: { checks: [], residue: [] }, row: RED });

    expect(lines[0]).toBe(
      "acme/widgets#16378 rebase-and-fix/spawn-ci · CI red, REQUIRED: unit; advisory red: vercel · rabbit green · " +
        'approved: alice · owners: none named · asked: no · "a change"',
    );
    expect(lines[1]).toBe("https://github.com/acme/widgets/pull/16378");
    expect(lines).toContain("dispatch: act rebase-and-fix: required CI is red");
    expect(lines).toContain("approved: alice");
    expect(lines).toContain("code owners: GitHub names no code owner for these paths");
    expect(lines).toContain("residue:");
    expect(lines).toContain("  a row residue line");
  });

  it("names each failing test file under its check and whether the PR added it, and an unread log by its reason", () => {
    const lines = landingDetailLines({
      evidence: {
        checks: [
          {
            check: "unit",
            linesCut: 0,
            testFiles: [
              { inPr: "added", path: "src/new.test.ts" },
              { inPr: "changed-existing", path: "src/old.test.ts" },
            ],
            unread: undefined,
          },
          { check: "vercel", linesCut: 0, testFiles: [], unread: "its details URL is not an Actions job" },
        ],
        residue: ["the file list was cut"],
      },
      row: RED,
    });

    const from = lines.indexOf("checks not passing:");
    expect(lines.slice(from, from + 6)).toEqual([
      "checks not passing:",
      "  REQUIRED unit (failed) https://github.com/acme/widgets/actions/runs/1/job/2",
      "    failing test file src/new.test.ts — ADDED in this pull request",
      "    failing test file src/old.test.ts — an existing file this pull request changes",
      "  advisory vercel (failed)",
      "    log not read: its details URL is not an Actions job",
    ]);
    expect(lines.slice(-3)).toEqual(["residue:", "  a row residue line", "  the file list was cut"]);
  });

  it("says a read log named no failing test file rather than printing nothing", () => {
    const lines = landingDetailLines({
      evidence: { checks: [{ check: "unit", linesCut: 0, testFiles: [], unread: undefined }], residue: [] },
      row: RED,
    });

    expect(lines).toContain("    its log names no failing test file");
  });

  it("never says a log named no failing test file when a line of it was cut before the search reached its end", () => {
    const lines = landingDetailLines({
      evidence: { checks: [{ check: "unit", linesCut: 2, testFiles: [], unread: undefined }], residue: [] },
      row: RED,
    });

    const from = lines.indexOf("  REQUIRED unit (failed) https://github.com/acme/widgets/actions/runs/1/job/2");
    expect(lines.slice(from + 1, from + 3)).toEqual([
      "    no failing test file found in the part of its log that was searched",
      "    2 log line(s) were cut at the line cap, so a failing test file past a cut is unseen",
    ]);
    expect(lines).not.toContain("    its log names no failing test file");
  });

  it("says there are no failing checks on a green row, and prints no residue block when there is none", () => {
    const lines = landingDetailLines({ evidence: { checks: [], residue: [] }, row: landingRowFake() });

    expect(lines).toContain("checks not passing: none");
    expect(lines).not.toContain("residue:");
  });
});
