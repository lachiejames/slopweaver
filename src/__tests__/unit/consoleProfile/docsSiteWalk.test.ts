/**
 * The page-switch walk `scripts/docs-site.sh` embeds in its Playwright driver, read off the committed script. It is a
 * second walk beside `../../../consoleProfile/plan.ts`'s, so nothing else pins it: when the sidebar cut retired Talk
 * its `/talk` stops became `/fleet`, and a walk left on a redirect times the
 * redirect rather than a page.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CONSOLE_ROUTES } from "../../../consoleProfile/plan.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SCRIPT = readFileSync(join(REPO_ROOT, "scripts", "docs-site.sh"), "utf8");

/**
 * One `const <name> = [...]` array of the driver, as written.
 *
 * @returns the array's paths
 */
function walkArray({ name }: { name: string }): readonly string[] {
  const line = SCRIPT.match(new RegExp(`^const ${name} = (\\[.*\\]);$`, "mu"))!;
  return JSON.parse(line[1]!) as readonly string[];
}

describe("docs-site.sh's page-switch walk", () => {
  it("loads and clicks the pages the sidebar draws, with no retired page among them", () => {
    expect(walkArray({ name: "pages" })).toEqual(["/queue", "/pull-requests", "/workstreams", "/fleet"]);
    expect(walkArray({ name: "clicks" })).toEqual([
      "/pull-requests",
      "/workstreams",
      "/fleet",
      "/queue",
      "/pull-requests",
      "/fleet",
    ]);
  });

  it("names only sidebar routes the walk plan knows", () => {
    const sidebar = CONSOLE_ROUTES.filter((route) => route.inSidebar).map((route) => route.path);
    expect(sidebar.length).toBeGreaterThan(0);
    const walked = [...walkArray({ name: "pages" }), ...walkArray({ name: "clicks" })];
    expect(walked.filter((path) => !sidebar.includes(path))).toEqual([]);
  });
});
