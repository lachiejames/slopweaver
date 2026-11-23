/**
 * The widened-recovery binding, in the two-describe shape `listenDeadlineInvocations.test.ts` established:
 * the first blocks drive the PURE criterion on inline fixtures and never touch disk; the last reads every file
 * of THIS repository's real working tree that could hit (`workingTreeFilesContaining`) and asserts none
 * advertises the widened gap pass as an inventory of conversation ids.
 *
 * What it holds down: the loop's widened pass was copied forward as thirteen hard-coded ids for over three
 * weeks, and it was blind to `C0SYN000011` (`#acme-bugs`) — a private channel the bot IS a
 * member of, never named by the literal. Nothing failed; a channel never opened reads
 * exactly like a quiet one. See `src/canon/recoveryChannelLiteral.ts` for the criterion and its blind spot.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { logicalLines } from "../../../canon/listenDeadline.js";
import {
  formatRecoveryChannelLiteral,
  realChannelIds,
  recoveryChannelLiteralOf,
  recoveryChannelLiterals,
} from "../../../canon/recoveryChannelLiteral.js";
import { repoRootOf, workingTreeFilesContaining } from "../../../lib/gitRepo.js";
import { readTextAhead } from "../../../lib/readAhead.js";
import { scanTextFiles, type TextFileScanResult } from "../../../lib/textFileScan.js";

/** The real private channel the hand-carried literal was blind to, and the shape it should have been. */
const ACME_BUGS = "C0SYN000011";

/** A second real id, so a fixture crosses the inventory threshold rather than sitting on it. */
const TYPED = "C0SYN000002";

/**
 * This binding's own two files, held out of the tree scan.
 *
 * Both spell an offending command on purpose — the module header to say what went wrong, this file to feed
 * it in as the fixture proving the criterion fires. A gate cannot be its own subject: those are INPUTS, not
 * advertisements. The hold-out is not free, so the test below asserts this file STILL produces an offender —
 * delete the fixture and the exclusion reddens rather than quietly covering nothing.
 */
const SELF_DECLARING: readonly string[] = [
  "src/canon/recoveryChannelLiteral.ts",
  "src/__tests__/unit/canon/recoveryChannelLiteral.test.ts",
];

/**
 * The shape the loop carried for three weeks, abbreviated to the two ids that matter to the criterion.
 *
 * Spelled out rather than interpolated on purpose: this line is also the live witness the self-exclusion
 * test reads back off disk, and `${TYPED},${ACME_BUGS}` in the SOURCE carries no id for the criterion to see.
 */
const HAND_CARRIED = "slopweaver listen recover --bot-user U0BOT --channels C0SYN000002,C0SYN000011 --since 3d";

/** Run the whole pipeline over one file's content, exactly as the tree scan does. */
function scanContent({
  content,
  path = "fixture.md",
}: {
  content: string;
  path?: string;
}): ReturnType<typeof recoveryChannelLiterals> {
  return recoveryChannelLiterals({ logicalLines: logicalLines({ content }), path });
}

describe("realChannelIds", () => {
  it("reads every real id out of a comma-separated value, in order", () => {
    expect(realChannelIds({ value: `${TYPED},${ACME_BUGS}` })).toEqual([TYPED, ACME_BUGS]);
  });

  it("reads none out of the placeholder canon actually writes, because an underscore ends the match", () => {
    expect(realChannelIds({ value: "C_ONE,C_TWO" })).toEqual([]);
  });

  it("reads none out of an angle-bracket placeholder", () => {
    expect(realChannelIds({ value: "<the" })).toEqual([]);
  });

  it("rejects a too-short id — Slack's own are nine characters or more", () => {
    expect(realChannelIds({ value: "C0SYN00,C01" })).toEqual([]);
  });

  it("reads a D and a G prefix, so a DM and a group DM are ids too", () => {
    expect(realChannelIds({ value: "D0SYN1ABCDEFGH,G0SYN1ABCDEFGH" })).toEqual(["D0SYN1ABCDEFGH", "G0SYN1ABCDEFGH"]);
  });

  it("reads an id of exactly nine characters, the floor the too-short case sits under", () => {
    expect(realChannelIds({ value: "C0SYNABCD,D0SYNABCD" })).toEqual(["C0SYNABCD", "D0SYNABCD"]);
  });
});

describe("recoveryChannelLiteralOf", () => {
  it("reports the hand-carried command the loop copied forward", () => {
    expect(recoveryChannelLiteralOf({ text: HAND_CARRIED })).toEqual([TYPED, ACME_BUGS]);
  });

  it("accepts ONE real id — a worked example of reply eligibility is not an inventory", () => {
    expect(recoveryChannelLiteralOf({ text: `listen recover --bot-user U0BOT --channels ${ACME_BUGS}` })).toBe(
      undefined,
    );
  });

  it("accepts the deriving command this repo settled on", () => {
    const derived =
      "listen recover --bot-user <the bot's USER id> --channels <the channels it answers in> --discover-channels --since 3d";
    expect(recoveryChannelLiteralOf({ text: derived })).toBe(undefined);
  });

  it("accepts the manifest's placeholder example, which names two channels and no real ids", () => {
    expect(recoveryChannelLiteralOf({ text: "listen recover --bot-user U_BOT --channels C_ONE,C_TWO" })).toBe(
      undefined,
    );
  });

  it("reads an equals-separated value the same way a space-separated one is read", () => {
    expect(recoveryChannelLiteralOf({ text: `listen recover --channels=${TYPED},${ACME_BUGS}` })).toEqual([
      TYPED,
      ACME_BUGS,
    ]);
  });

  it("is verb-scoped: the same --channels inventory on `listen arm` is a different verb and is never read", () => {
    expect(recoveryChannelLiteralOf({ text: `listen arm --background --channels ${TYPED},${ACME_BUGS}` })).toBe(
      undefined,
    );
  });

  it("ignores a `listen recover` line that names no --channels at all", () => {
    expect(recoveryChannelLiteralOf({ text: "listen recover --scheduled --json" })).toBe(undefined);
  });

  it("stops at the flag's own value, so an id in a LATER flag is not absorbed into the count", () => {
    expect(recoveryChannelLiteralOf({ text: `listen recover --channels ${ACME_BUGS} --thread-replies ${TYPED}` })).toBe(
      undefined,
    );
  });
});

describe("recoveryChannelLiterals", () => {
  it("folds a backslash continuation, so a command split across lines is still judged whole", () => {
    const split = `"\${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" listen recover --bot-user U0BOT \\\n  --channels ${TYPED},${ACME_BUGS} --since 3d\n`;
    expect(scanContent({ content: split, path: "edge-cases.md" })).toEqual([
      { channels: [TYPED, ACME_BUGS], line: 1, path: "edge-cases.md" },
    ]);
  });

  it("finds every offending line rather than stopping at the first", () => {
    const content = `${HAND_CARRIED}\nsome prose\n${HAND_CARRIED}\n`;
    expect(scanContent({ content }).map((literal) => literal.line)).toEqual([1, 3]);
  });

  it("reports nothing over content that carries no invocation at all", () => {
    expect(scanContent({ content: "# a heading\n\nprose about recovery\n" })).toEqual([]);
  });
});

describe("formatRecoveryChannelLiteral", () => {
  it("prints the site, the ids and the fix", () => {
    const [literal] = scanContent({ content: HAND_CARRIED, path: "skills/loop/reference/edge-cases.md" });
    expect(formatRecoveryChannelLiteral({ literal: literal! })).toBe(
      `skills/loop/reference/edge-cases.md:1  hard-codes 2 channel ids (${TYPED}, ${ACME_BUGS}) — ` +
        "widen with --discover-channels instead",
    );
  });
});

describe("this repository's own canon", () => {
  const root = repoRootOf({ importMetaUrl: import.meta.url });
  // Only a file holding `--channels` can hit: the criterion matches that flag on a logical line, and a fold joins
  // two physical lines with a SPACE, so it cannot assemble the flag across them. `--discover-channels` is what the
  // advertised case reads. Selecting by git's own grep reads ~34 files, not all ~21,000 (the helper's measurement).
  const selected = workingTreeFilesContaining({
    fixedStrings: ["--channels", "--discover-channels"],
    pathspecs: ["*.md", "*.ts"],
    root,
  });
  const paths = selected.filter((path) => !SELF_DECLARING.includes(path));
  // Read once, concurrently, in a hook rather than at collection, and shared by every case below, which only read it.
  let readText: (args: { path: string }) => string;
  let scan: TextFileScanResult<ReturnType<typeof recoveryChannelLiterals>[number]>;
  beforeAll(async () => {
    readText = await readTextAhead({ paths: [...paths, ...SELF_DECLARING], root });
    scan = scanTextFiles({
      paths,
      readText,
      scan: ({ content, path }) => recoveryChannelLiterals({ logicalLines: logicalLines({ content }), path }),
    });
  });

  it("read every candidate it selected — a gate reporting clean over an unread file is the defect one level up", () => {
    expect(scan.unreadable).toEqual([]);
    expect(scan.scanned).toBeGreaterThan(0);
  });

  it("still holds a live offending example in each self-excluded file, so the exclusion cannot hide a rot", () => {
    // Both are selected by `--channels` from a `.ts` file, so the selector is live, not merely bypassed.
    expect(SELF_DECLARING.filter((path) => selected.includes(path))).toEqual(SELF_DECLARING);
    const found = SELF_DECLARING.map((path) => scanContent({ content: readText({ path }), path }).length);
    expect(found.length).toBe(2);
    expect(found.filter((count) => count === 0)).toEqual([]);
  });

  it("still advertises the widened pass somewhere, so an empty offender list is a clean tree not a dead filter", () => {
    const advertised = paths.filter((path) => readText({ path }).includes("--discover-channels"));
    expect(advertised).toContain("skills/loop/reference/edge-cases.md");
    expect(advertised).toContain("skills/loop/SKILL.md");
  });

  it("carries no hand-written channel inventory on any `listen recover` line", () => {
    expect(scan.hits.map((literal) => formatRecoveryChannelLiteral({ literal }))).toEqual([]);
  });
});
