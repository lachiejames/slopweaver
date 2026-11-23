/**
 * A console rebuild never typechecks against another dist directory's stale route types —
 * `scripts/docs-site.sh`'s `clear_generated_types`, run for real through its `--clear-generated-types` seam.
 *
 * The incident: a change deleted `site/app/(console)/page.tsx`, and every refresh round after it failed
 * with TS2307 because `site/tsconfig.json` includes the generated `types/` of `.next`, `.next/dev` and the serving
 * slot, whose `validator.ts` still imported the deleted page. The script is copied into a throwaway root beside a
 * fake `site/`, since it resolves the site from its own path, and the seam must empty every generated types
 * directory while leaving each build's own files where they were.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = join(repoRoot, "scripts", "docs-site.sh");
/** Every dist directory `site/tsconfig.json` includes generated types from. */
const DISTS = [".next", ".next-serve-a", ".next-serve-b"] as const;
const STALE = "import '../../app/(console)/page.js';\n";

let root: string | undefined;

afterEach(() => {
  if (root !== undefined) {
    rmSync(root, { force: true, recursive: true });
    root = undefined;
  }
});

/** Write one file, making its directory first. */
function put({ path, body }: { path: string; body: string }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

describe("docs-site --clear-generated-types", () => {
  it("removes every dist directory's types and dev types, and keeps each build's own files", () => {
    root = mkdtempSync(join(tmpdir(), "docs-types-"));
    cpSync(SCRIPT, join(root, "scripts", "docs-site.sh"));
    const site = join(root, "site");
    for (const dist of DISTS) {
      put({ body: STALE, path: join(site, dist, "types", "validator.ts") });
      put({ body: STALE, path: join(site, dist, "dev", "types", "validator.ts") });
      put({ body: `${dist}\n`, path: join(site, dist, "BUILD_ID") });
      put({ body: `${dist}\n`, path: join(site, dist, "dev", "build-manifest.json") });
    }

    const run = spawnSync("bash", [join(root, "scripts", "docs-site.sh"), "--clear-generated-types"], {
      encoding: "utf8",
      env: { ...process.env, SLOPWEAVER_HOME: join(root, "home") },
    });

    expect(run.status).toBe(0);
    expect(DISTS.filter((dist) => existsSync(join(site, dist, "types")))).toEqual([]);
    expect(DISTS.filter((dist) => existsSync(join(site, dist, "dev", "types")))).toEqual([]);
    expect(DISTS.map((dist) => readFileSync(join(site, dist, "BUILD_ID"), "utf8"))).toEqual([
      ".next\n",
      ".next-serve-a\n",
      ".next-serve-b\n",
    ]);
    expect(DISTS.map((dist) => readFileSync(join(site, dist, "dev", "build-manifest.json"), "utf8"))).toEqual([
      ".next\n",
      ".next-serve-a\n",
      ".next-serve-b\n",
    ]);
  });

  it("answers zero on a site with no dist directory at all", () => {
    root = mkdtempSync(join(tmpdir(), "docs-types-"));
    cpSync(SCRIPT, join(root, "scripts", "docs-site.sh"));
    mkdirSync(join(root, "site"));

    const run = spawnSync("bash", [join(root, "scripts", "docs-site.sh"), "--clear-generated-types"], {
      encoding: "utf8",
      env: { ...process.env, SLOPWEAVER_HOME: join(root, "home") },
    });

    expect(run.status).toBe(0);
    expect(existsSync(join(root, "site", ".next"))).toBe(false);
  });
});
