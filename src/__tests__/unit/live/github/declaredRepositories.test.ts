import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readDeclaredRepositories } from "../../../../live/github/declaredRepositories.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";

describe("readDeclaredRepositories (real git, scratch home)", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  const made: string[] = [];
  afterEach(() => {
    while (made.length > 0) {
      rmSync(made.pop()!, { force: true, recursive: true });
    }
  });
  const scratch = ({ prefix }: { prefix: string }): string => {
    const dir = mkdtempSync(join(tmpdir(), `slopweaver-${prefix}-`));
    made.push(dir);
    return dir;
  };
  const checkoutOf = ({ slug }: { slug: string | null }): string => {
    const dir = scratch({ prefix: "checkout" });
    gitInTemp({ args: ["init", "--quiet"], cwd: dir });
    if (slug !== null) {
      gitInTemp({ args: ["remote", "add", "origin", `https://github.com/${slug}.git`], cwd: dir });
    }
    return dir;
  };
  const homeDeclaring = ({ paths }: { paths: readonly string[] }): string => {
    const home = scratch({ prefix: "home" });
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({
        displayName: "",
        gitNamespace: "",
        id: "me",
        mainCheckouts: paths.map((path) => ({ path })),
        schemaVersion: 1,
        sources: [],
      }),
      "utf8",
    );
    return home;
  };

  it("resolves every declared checkout in declaration order, each repository once", () => {
    const widget = checkoutOf({ slug: "acme/widget" });
    const gadget = checkoutOf({ slug: "acme/gadget" });
    const widgetAgain = checkoutOf({ slug: "acme/widget" });

    const read = readDeclaredRepositories({ home: homeDeclaring({ paths: [widget, gadget, widgetAgain] }) });

    expect(read).toEqual({ slugs: ["acme/widget", "acme/gadget"], unresolved: [] });
  });

  it("returns a checkout whose origin will not resolve rather than dropping it", () => {
    const widget = checkoutOf({ slug: "acme/widget" });
    const remoteless = checkoutOf({ slug: null });

    const read = readDeclaredRepositories({ home: homeDeclaring({ paths: [widget, remoteless] }) });

    expect(read).toEqual({ slugs: ["acme/widget"], unresolved: [remoteless] });
  });

  it("reads nothing from a home that declares no checkout", () => {
    expect(readDeclaredRepositories({ home: homeDeclaring({ paths: [] }) })).toEqual({ slugs: [], unresolved: [] });
  });
});
