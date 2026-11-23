/** `slack shot` refuses an `--out` a checkout could carry before it opens anything. */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { SlackShotOptions } from "../../../../../cli/commands/slack/shotCore.js";
import { slackShotPlacementRefusal } from "../../../../../cli/commands/slack/shotRun.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh canonical scratch directory. */
function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "slack-shot-placement-")));
  fixtureDirs.push(dir);
  return dir;
}

/** An invocation writing to `out`. */
function options({ out }: { out: string }): SlackShotOptions {
  return {
    channel: "C0123",
    home: undefined,
    json: false,
    messageTs: "1758960000.000100",
    out,
    settleMs: 0,
    url: "https://example.slack.com/archives/C0123/p1758960000000100",
  };
}

describe("slackShotPlacementRefusal", () => {
  it("refuses an --out inside a checkout, as its own outcome", () => {
    const dir = scratch();
    gitInTemp({ args: ["init", "-q"], cwd: dir });
    const report = slackShotPlacementRefusal({
      cwd: dir,
      env: {},
      home: join(dir, "..", "home"),
      options: options({ out: "proof/thread.png" }),
    })!;
    expect(report.outcome).toBe("output-in-checkout");
    expect(report.because).toContain(`${join(dir, "proof", "thread.png")} is inside the git checkout ${dir}`);
  });

  it("allows an --out outside every checkout", () => {
    const dir = scratch();
    expect(
      slackShotPlacementRefusal({ cwd: dir, env: {}, home: join(dir, "home"), options: options({ out: "a.png" }) }),
    ).toBe(undefined);
  });
});
