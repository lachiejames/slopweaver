/**
 * `browser shot` refuses an `--out` a checkout could carry before it opens anything — the Slopweaver checkout
 * it runs from included.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { BrowserShotOptions } from "../../../../../cli/commands/browser/shotCore.js";
import { shotPlacementRefusal } from "../../../../../cli/commands/browser/shotRun.js";
import { repoRootOf } from "../../../../../lib/gitRepo.js";
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
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "shot-placement-")));
  fixtureDirs.push(dir);
  gitInTemp({ args: ["init", "-q"], cwd: dir });
  return dir;
}

/** A raw-profile invocation writing to `out`. */
function options({ out }: { out: string }): BrowserShotOptions {
  return {
    home: undefined,
    json: false,
    mode: { kind: "raw", settleMs: 0 },
    out,
    url: "https://staging.example.test/",
  };
}

describe("shotPlacementRefusal", () => {
  it("refuses an --out inside a checkout, as its own outcome", () => {
    const dir = checkout();
    const report = shotPlacementRefusal({
      cwd: dir,
      env: {},
      home: join(dir, "..", "home"),
      options: options({ out: "screenshots/staging.png" }),
    })!;
    expect(report.outcome).toBe("output-in-checkout");
    expect(report.path).toBe(null);
    expect(report.because).toContain(`${join(dir, "screenshots", "staging.png")} is inside the git checkout ${dir}`);
  });

  it("refuses the site's captures folder of the Slopweaver checkout it runs from", () => {
    const own = realpathSync(repoRootOf({ importMetaUrl: import.meta.url }));
    const report = shotPlacementRefusal({
      cwd: own,
      env: {},
      home: join(own, "..", "home"),
      options: options({ out: "site/public/captures/card-fold.png" }),
    })!;
    expect(report.outcome).toBe("output-in-checkout");
  });

  it("refuses the same folder in a repository that merely calls itself Slopweaver", () => {
    const dir = checkout();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "slopweaver" }));
    const report = shotPlacementRefusal({
      cwd: dir,
      env: {},
      home: join(dir, "..", "home"),
      options: options({ out: "site/public/captures/card-fold.png" }),
    })!;
    expect(report.outcome).toBe("output-in-checkout");
  });

  it("allows an --out outside every checkout", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "shot-placement-")));
    fixtureDirs.push(dir);
    expect(
      shotPlacementRefusal({ cwd: dir, env: {}, home: join(dir, "home"), options: options({ out: "a.png" }) }),
    ).toBe(undefined);
  });
});
