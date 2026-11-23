/**
 * {@link runSessionSpend} — the shipped runner, driven over a fixture corpus and a throwaway home.
 *
 * `--projects-dir` and `--home` are the seams: the corpus is a temp directory, and a fresh home declares no main
 * checkout, so no repository is counted and the pass never reaches GitHub — landings read NOT MEASURED instead.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runSessionSpend, SPEND_PRODUCER } from "../../../../cli/commands/session/spend.js";
import { findingOutcome } from "../../../../cli/commands/session/spendFinding.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { unwrap } from "../../../../lib/result.js";
import { measured } from "../../../../measurement/status.js";
import { lastReading } from "../../../../readings/store.js";
import { spendReport } from "../../../../sessions/spendReport.js";
import type { SpendSignal } from "../../../../sessions/spendSignal.js";

let projectsDir = "";
let home = "";

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "spend-cli-"));
  home = mkdtempSync(join(tmpdir(), "spend-home-"));
});

afterEach(() => {
  rmSync(projectsDir, { force: true, recursive: true });
  rmSync(home, { force: true, recursive: true });
});

/** The runner's argv, with the two seams already pointed at this test's own state. */
function argv({ flags }: { flags: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "session", "spend", "--projects-dir", projectsDir, "--home", home, ...flags];
}

describe("runSessionSpend", () => {
  it("records a reading over an empty corpus, posting nothing", async () => {
    expect(await runSessionSpend(argv({ flags: ["--json", "--record-reading", "a test"] }))).toBe(EXIT_OK);
    const document = unwrap(lastReading({ home, producer: SPEND_PRODUCER })).document;
    expect(document).toMatchObject({ drains: [], posted: [], transcripts: 0, units: 0 });
  });

  it("exits 0 with --finding when there is nothing to show, so the standing row stamps", async () => {
    expect(await runSessionSpend(argv({ flags: ["--finding", "--record-reading", "a test"] }))).toBe(EXIT_OK);
  });

  it("refuses --finding with no reading behind it, which the next pass would post again", async () => {
    expect(await runSessionSpend(argv({ flags: ["--finding"] }))).toBe(EXIT_USAGE);
  });

  it("refuses a share that is not a fraction", async () => {
    expect(await runSessionSpend(argv({ flags: ["--min-share", "5"] }))).toBe(EXIT_ERROR);
  });

  it("refuses an unknown flag with a usage code rather than running the pass", async () => {
    expect(await runSessionSpend(argv({ flags: ["--not-a-flag"] }))).toBe(EXIT_USAGE);
  });

  it("prints usage and exits 0 for --help", async () => {
    expect(await runSessionSpend(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("errors rather than reporting zero when the corpus directory is not there", async () => {
    const missing = ["node", "slopweaver", "session", "spend", "--projects-dir", join(projectsDir, "gone")];
    expect(await runSessionSpend([...missing, "--home", home])).toBe(EXIT_ERROR);
  });
});

describe("findingOutcome", () => {
  const report = spendReport({
    days: ["2026-09-27"],
    landings: measured({ value: [] }),
    observedAtIso: "2026-09-28T05:30:00.000Z",
    repos: [],
    transcripts: [],
  });
  const steady: SpendSignal = { because: "moved 1.0%", carried: [], post: [], trend: "steady" };

  it("registers nothing when --finding was not passed, whatever the verdict", async () => {
    const win: SpendSignal = { ...steady, trend: "win" };
    expect(await findingOutcome({ asked: false, evidence: "e", home, report, signal: win })).toBe("not-asked");
  });

  it("registers nothing for a steady pass with no drain to post", async () => {
    expect(await findingOutcome({ asked: true, evidence: "e", home, report, signal: steady })).toBe("nothing-to-show");
  });
});
