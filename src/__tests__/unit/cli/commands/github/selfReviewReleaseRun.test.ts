import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type GithubSelfReviewReleaseDeps,
  runGithubSelfReviewRelease,
} from "../../../../../cli/commands/github/selfReviewReleaseRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { readSelfReviewReservation, reserveSelfReviewRound } from "../../../../../outbound/github/selfReviewLedger.js";
import { stateHomePaths } from "../../../../../stateHome.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "self-review-release-run-"));
  fixtureDirs.push(home);
  return home;
}

function harness(): { deps: GithubSelfReviewReleaseDeps; lines: string[]; diagnostics: string[] } {
  const lines: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      home: () => {
        throw new Error("--home was not supplied and the default should not be reached in a test");
      },
      out: (line) => lines.push(line),
      writeDiagnostic: (line) => diagnostics.push(line),
    },
    diagnostics,
    lines,
  };
}

describe("runGithubSelfReviewRelease", () => {
  it("reports nothing held for a locus with no reservation", () => {
    const home = tempHome();
    const { deps, lines } = harness();
    const code = runGithubSelfReviewRelease({
      deps,
      rest: ["--repo", "o/r", "--pr", "7", "--home", home],
    });
    expect(code).toBe(EXIT_OK);
    expect(lines).toEqual(["self-review release: no held reservation for o/r#7"]);
  });

  it("releases a held reservation and names what it released", () => {
    const home = tempHome();
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "abc123", locus: "o/r#7", reservedIso: "t1" },
      pullRequestId: "PR7",
    });
    const { deps, lines } = harness();
    const code = runGithubSelfReviewRelease({
      deps,
      rest: ["--repo", "o/r", "--pr", "7", "--home", home],
    });
    expect(code).toBe(EXIT_OK);
    expect(lines).toEqual(["self-review release: released o/r#7 — held for head abc123, reserved at t1"]);
    expect(unwrap(readSelfReviewReservation({ home, locus: "o/r#7" }))).toBeNull();
  });

  it("refuses a --head mismatch instead of releasing a different, still-live reservation", () => {
    const home = tempHome();
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "abc123", locus: "o/r#7", reservedIso: "t1" },
      pullRequestId: "PR7",
    });
    const { deps, diagnostics } = harness();
    const code = runGithubSelfReviewRelease({
      deps,
      rest: ["--repo", "o/r", "--pr", "7", "--head", "wrong-sha", "--home", home],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(diagnostics).toEqual([
      "self-review release: refused — o/r#7 is held for head abc123, not the requested wrong-sha",
    ]);
    expect(unwrap(readSelfReviewReservation({ home, locus: "o/r#7" }))).toEqual({
      formHash: "f",
      headSha: "abc123",
      locus: "o/r#7",
      reservedIso: "t1",
    });
  });

  it("refuses a reservation that is there but corrupt, naming its path, and releases nothing", () => {
    const home = tempHome();
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "abc123", locus: "o/r#7", reservedIso: "t1" },
      pullRequestId: "PR7",
    });
    const ledger = join(stateHomePaths({ home }).ledgers, "github-self-reviews");
    const path = join(
      ledger,
      readdirSync(ledger).find((name) => name.endsWith(".lock"))!,
      "reservation.json",
    );
    writeFileSync(path, "{");
    const { deps, diagnostics, lines } = harness();
    const code = runGithubSelfReviewRelease({ deps, rest: ["--repo", "o/r", "--pr", "7", "--home", home] });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toEqual([]);
    expect(diagnostics).toEqual([
      `self-review release: refused — ${unwrapErr(readSelfReviewReservation({ home, locus: "o/r#7" }))[0]}`,
    ]);
    expect(readFileSync(path, "utf8")).toBe("{");
  });

  it("releases when --head matches exactly", () => {
    const home = tempHome();
    reserveSelfReviewRound({
      home,
      intent: { formHash: "f", headSha: "abc123", locus: "o/r#7", reservedIso: "t1" },
      pullRequestId: "PR7",
    });
    const { deps, lines } = harness();
    const code = runGithubSelfReviewRelease({
      deps,
      rest: ["--repo", "o/r", "--pr", "7", "--head", "abc123", "--home", home],
    });
    expect(code).toBe(EXIT_OK);
    expect(lines).toEqual(["self-review release: released o/r#7 — held for head abc123, reserved at t1"]);
  });

  it("reports every usage problem and refuses to touch the ledger", () => {
    const { deps, diagnostics } = harness();
    const code = runGithubSelfReviewRelease({ deps, rest: ["--pr", "0"] });
    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics).toContain("--repo owner/name is required");
    expect(diagnostics).toContain("--pr must be a positive whole number");
  });
});
