/**
 * `reviewAfterCleanRefusal` — a round after a CLEAN one is refused with the code diff of the two answer files,
 * never booted. A real temp home, because the diff is read back from the reviewed-answer snapshot on disk.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { reviewAfterCleanRefusal } from "../../../../../cli/commands/turn/reviewAfterClean.js";
import { reviewPaths, writeReviewedAnswer } from "../../../../../live/turn/reviewStore.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const ASK = { channel: "C1", messageTs: "1789443736.519609", threadTs: "1789443736.519609" };
const DIGEST = "sha256:" + "b".repeat(64);
const REVIEWED = { body: ["the pool exhausted at 14:02"], lead: "The staging pool exhausted" };
const TIDIED = { body: ["the pool exhausted at 14:02"], lead: "The staging pool ran out" };

/** A home holding the answer round 1 reviewed, keyed by the digest its clean verdict bound. */
function homeWithReviewedAnswer(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-after-clean-"));
  dirs.push(home);
  writeReviewedAnswer({ answer: REVIEWED, askIdentity: ASK, digest: DIGEST, home });
  return home;
}

describe("reviewAfterCleanRefusal", () => {
  it("refuses a round after a clean one, naming what moved and the file to post", () => {
    const home = homeWithReviewedAnswer();
    const lines = reviewAfterCleanRefusal({
      answer: TIDIED,
      askIdentity: ASK,
      env: {},
      home,
      inherited: { previousOutcome: "clean", round: 2, settledDigest: DIGEST },
    });
    const text = lines.join("\n");

    expect(lines[0]).toBe(`round 1 of review for this ask came back CLEAN, bound to ${DIGEST}.`);
    expect(text).toContain("- `/lead` — changed");
    expect(text).toContain(
      join(reviewPaths({ askIdentity: ASK, home }).dir, `answer-reviewed-sha256-${"b".repeat(64)}.json`),
    );
    expect(text).toContain("slopweaver turn review --answer blocked because the previous reviewer round");
    expect(text).toContain("SLOPWEAVER_ALLOW_REVIEW_AFTER_CLEAN=1");
  });

  it("opens the round when the previous one was not clean", () => {
    const home = homeWithReviewedAnswer();

    expect(
      reviewAfterCleanRefusal({
        answer: TIDIED,
        askIdentity: ASK,
        env: {},
        home,
        inherited: { previousOutcome: "broken", round: 2, settledDigest: DIGEST },
      }),
    ).toStrictEqual([]);
  });

  it("opens round 1, which has no previous outcome", () => {
    const home = homeWithReviewedAnswer();

    expect(
      reviewAfterCleanRefusal({
        answer: TIDIED,
        askIdentity: ASK,
        env: {},
        home,
        inherited: { previousOutcome: undefined, round: 1, settledDigest: undefined },
      }),
    ).toStrictEqual([]);
  });

  it("opens the round when the hatch is set — a low claim that is materially wrong", () => {
    const home = homeWithReviewedAnswer();

    expect(
      reviewAfterCleanRefusal({
        answer: TIDIED,
        askIdentity: ASK,
        env: { SLOPWEAVER_ALLOW_REVIEW_AFTER_CLEAN: "1" },
        home,
        inherited: { previousOutcome: "clean", round: 2, settledDigest: DIGEST },
      }),
    ).toStrictEqual([]);
  });
});
