// deleted-with-code: POLICY_PULL_USAGE
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { POLICY_USAGE, runPolicy } from "../../../../../cli/commands/policy/run.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { policyManifest } from "../../../../../cli/manifests/policy.js";

const homes: string[] = [];

/** A throwaway directory to point a render at, so a missing file is genuinely missing. */
function emptyHome(): string {
  const home = mkdtempSync(join(tmpdir(), "policy-cmd-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** The argv shape the CLI dispatches with: the noun at index 2, the verb at index 3. */
function argv(...rest: readonly string[]): readonly string[] {
  return ["node", "slopweaver", "policy", ...rest];
}

describe("policyManifest", () => {
  it("declares the two verbs the noun answers", () => {
    expect(Object.keys(policyManifest).toSorted()).toStrictEqual(["diff", "render"]);
  });

  it("declares both verbs door-free, because neither reaches a provider", () => {
    for (const verb of ["diff", "render"]) {
      expect(policyManifest[verb]!.meta.doorRouted).toBe(false);
      expect(policyManifest[verb]!.meta.createsWorkItem).toBe(false);
      expect(policyManifest[verb]!.meta.effect).toBe("local-state");
    }
  });

  it("gives render a usage naming exactly the flags its own parser accepts", () => {
    expect(policyManifest["render"]!.meta.usage).toBe(
      "usage: slopweaver policy render --file <path.md> --out <path.pdf> [--json]",
    );
  });
});

describe("runPolicy", () => {
  it("prints the usage and succeeds when asked for help", async () => {
    expect(await runPolicy(argv("--help"))).toBe(EXIT_OK);
  });

  it("prints the usage and succeeds when given no verb at all", async () => {
    expect(await runPolicy(argv())).toBe(EXIT_OK);
  });

  it("refuses a verb this noun does not answer", async () => {
    expect(await runPolicy(argv("publish"))).toBe(EXIT_USAGE);
  });

  it("refuses the retired mirror verbs as verbs it does not answer", async () => {
    expect(await runPolicy(argv("pull"))).toBe(EXIT_USAGE);
    expect(await runPolicy(argv("import", "--out", "/x"))).toBe(EXIT_USAGE);
    expect(await runPolicy(argv("drift"))).toBe(EXIT_USAGE);
  });

  it("refuses a render with neither --file nor --out", async () => {
    expect(await runPolicy(argv("render"))).toBe(EXIT_USAGE);
  });

  it("refuses a render whose markdown is not there", async () => {
    const home = emptyHome();
    expect(await runPolicy(argv("render", "--file", join(home, "nope.md"), "--out", join(home, "x.pdf")))).toBe(
      EXIT_ERROR,
    );
  });

  it("names exactly the two verbs in the usage it prints", () => {
    expect(POLICY_USAGE.split("\n")[0]).toBe("usage: slopweaver policy <render|diff>");
  });
});
