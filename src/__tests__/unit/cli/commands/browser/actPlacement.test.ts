/**
 * `browser act` refuses an after-picture `--out` a checkout could carry before it touches the session, and
 * leaves a download's `--out` alone, because a downloaded file is the result a caller came for, not proof.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { BrowserActOptions } from "../../../../../cli/commands/browser/actionCore.js";
import { actOutputRefusal } from "../../../../../cli/commands/browser/actPreflight.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway git work tree, canonicalised. */
function checkout(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "act-placement-")));
  fixtureDirs.push(dir);
  gitInTemp({ args: ["init", "-q"], cwd: dir });
  return dir;
}

/** An invocation of `kind` writing to `out`. */
function options({ kind, out }: { kind: BrowserActOptions["kind"]; out: string | undefined }): BrowserActOptions {
  return {
    downloadDir: undefined,
    expectFocus: undefined,
    expectName: undefined,
    focus: false,
    fullPage: false,
    json: false,
    kind,
    observationId: undefined,
    out,
    sessionId: "s-1",
    target: "e1",
    value: undefined,
  };
}

describe("actOutputRefusal", () => {
  it("refuses an after-picture inside a checkout", () => {
    const dir = checkout();
    const lines = actOutputRefusal({
      cwd: dir,
      env: {},
      home: join(dir, "..", "home"),
      options: options({ kind: "click", out: "proof/after.png" }),
    });
    expect(lines[0]).toBe(
      `${join(dir, "proof", "after.png")} is inside the git checkout ${dir}, where a commit can carry it into a pull request; nothing was captured`,
    );
  });

  it("does not judge a download's --out", () => {
    const dir = checkout();
    expect(
      actOutputRefusal({
        cwd: dir,
        env: {},
        home: join(dir, "..", "home"),
        options: options({ kind: "download", out: "report.csv" }),
      }),
    ).toEqual([]);
  });

  it("has nothing to judge without --out", () => {
    const dir = checkout();
    expect(
      actOutputRefusal({ cwd: dir, env: {}, home: dir, options: options({ kind: "click", out: undefined }) }),
    ).toEqual([]);
  });
});
