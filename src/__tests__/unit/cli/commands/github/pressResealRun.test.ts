import { describe, expect, it } from "vitest";

import { parseGithubPressResealArgs } from "../../../../../cli/commands/github/pressResealArgs.js";
import { pressResealApplyLine, runGithubPressReseal } from "../../../../../cli/commands/github/pressResealRun.js";
import { GITHUB_PRESS_RESEAL_USAGE } from "../../../../../cli/commands/github/pressResealUsage.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { type PressRecord, pressKey } from "../../../../../review/pressJournal.js";
import type { StoredPress } from "../../../../../review/pressJournalPort.js";
import { type PressResealSeams, pressRegisterDigest } from "../../../../../review/pressReseal.js";

const HOME = "/nonexistent/press-reseal-run-home";
const HEX = "a".repeat(64);

const record: PressRecord = {
  atIso: "2026-10-01T00:00:00.000Z",
  entryState: "QUEUED",
  headOid: "1111111111111111111111111111111111111111",
  number: 4,
  repoSlug: "old-org/slopweaver",
};
const CARRIED: StoredPress = { ...record, pressKey: pressKey({ record: { ...record, repoSlug: "acme/widgets" } }) };

/** Seams over a fixed register whose transaction refuses to run, so a test proves no apply happened. */
const readOnlySeams = ({ rows }: { rows: readonly StoredPress[] }): PressResealSeams => ({
  appendReceipt: () => ok("unreached"),
  inTransaction: () => {
    throw new Error("a preview must not open a transaction");
  },
  readStored: () => Promise.resolve(ok(rows)),
});

const run = async ({
  rest,
  rows,
}: {
  rest: readonly string[];
  rows: readonly StoredPress[];
}): Promise<{ code: number; lines: string[] }> => {
  const lines: string[] = [];
  const code = await runGithubPressReseal({
    argv: ["node", "slopweaver", "github", "press-reseal", ...rest],
    deps: {
      nowIso: () => "2026-11-17T09:00:00.000Z",
      out: ({ line }) => {
        lines.push(line);
      },
      seams: readOnlySeams({ rows }),
    },
  });
  return { code, lines };
};

describe("parseGithubPressResealArgs", () => {
  it("reads a preview naming several repositories, deduplicated", () => {
    expect(unwrap(parseGithubPressResealArgs({ rest: ["--repo", "a/b", "--repo", "c/d", "--repo", "a/b"] }))).toEqual({
      asJson: false,
      home: undefined,
      mode: "preview",
      repos: ["a/b", "c/d"],
    });
  });

  it("reads an apply carrying the digest and the reason", () => {
    const rest = ["--repo", "a/b", "--apply", "--source-sha256", HEX, "--reason", "carried", "--home", HOME, "--json"];

    expect(unwrap(parseGithubPressResealArgs({ rest }))).toEqual({
      asJson: true,
      home: HOME,
      mode: "apply",
      reason: "carried",
      repos: ["a/b"],
      sourceSha256: HEX,
    });
  });

  it("refuses a missing --repo", () => {
    expect(unwrapErr(parseGithubPressResealArgs({ rest: [] }))).toEqual([
      "--repo owner/name is required: name every repository whose rows may be re-keyed",
    ]);
  });

  it("refuses an apply with no digest or reason", () => {
    expect(
      unwrapErr(parseGithubPressResealArgs({ rest: ["--repo", "a/b", "--apply", "--source-sha256", "abc"] })),
    ).toEqual([
      "--apply needs --source-sha256 <hex>: the 64-character sourceSha256 the preview printed",
      '--apply needs --reason "<why>": it is recorded on the receipt',
    ]);
  });

  it("refuses an apply-only flag on a preview by name", () => {
    expect(unwrapErr(parseGithubPressResealArgs({ rest: ["--repo", "a/b", "--reason", "x"] }))).toEqual([
      "--reason belongs to --apply; without --apply this is a preview and writes nothing",
    ]);
  });
});

describe("runGithubPressReseal", () => {
  it("previews without writing and prints the exact apply line", async () => {
    const { code, lines } = await run({ rest: ["--repo", "old-org/slopweaver", "--home", HOME], rows: [CARRIED] });
    const applyLine = pressResealApplyLine({
      home: HOME,
      repos: ["old-org/slopweaver"],
      sourceSha256: pressRegisterDigest({ stored: [CARRIED] }),
    });

    expect(code).toBe(EXIT_OK);
    expect(lines).toContain(`  ${applyLine}`);
    expect(lines).toContain("  old-org/slopweaver: 1 rows to re-key");
    expect(lines).toContain(`  old-org/slopweaver#4 ${CARRIED.pressKey} -> ${pressKey({ record })}`);
  });

  it("answers expected-empty on a sound register", async () => {
    const soundRow: StoredPress = { ...record, pressKey: pressKey({ record }) };
    const { code } = await run({ rest: ["--repo", "old-org/slopweaver", "--home", HOME], rows: [soundRow] });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("refuses when a mismatched row's repository was not named", async () => {
    const { code, lines } = await run({ rest: ["--repo", "acme/widgets", "--home", HOME], rows: [CARRIED] });

    expect(code).toBe(EXIT_ERROR);
    expect(lines[0]).toContain("refused: rows of old-org/slopweaver are stored under keys");
  });

  it("refuses bad argv as usage", async () => {
    const { code, lines } = await run({ rest: ["--home", HOME], rows: [] });

    expect(code).toBe(EXIT_USAGE);
    expect(lines).toEqual([
      "--repo owner/name is required: name every repository whose rows may be re-keyed",
      GITHUB_PRESS_RESEAL_USAGE,
    ]);
  });
});
