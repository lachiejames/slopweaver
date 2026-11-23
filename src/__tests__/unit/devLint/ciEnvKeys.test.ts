import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ENV_KEYS, envKeyFindings, unpinnedEnvKeys } from "../../../devLint/ciEnvKeys.js";
import { CI_WORKFLOW_PATH } from "../../../devLint/ciOffloadContract.js";
import { repoRootOf } from "../../../lib/gitRepo.js";

const TAIL =
  " in an `env`, outside ENV_KEYS (ciEnvKeys.ts), which could change what a pinned command does before it runs — `BASH_ENV` and `NODE_OPTIONS` among them";

describe("unpinnedEnvKeys", () => {
  it("passes an absent block and one carrying only pinned keys", () => {
    expect(ENV_KEYS.size).toBeGreaterThan(0);
    expect(unpinnedEnvKeys({ env: undefined })).toEqual([]);
    expect(unpinnedEnvKeys({ env: Object.fromEntries([...ENV_KEYS].map((key) => [key, "1"])) })).toEqual([]);
  });

  it("names every other key, an expression key, and a block it cannot read as a map", () => {
    expect(
      unpinnedEnvKeys({ env: { MIN_TOTAL_MIB: 1, NODE_OPTIONS: "--import=x", "${{ 'BASH_ENV' }}": "/p" } }),
    ).toEqual(["NODE_OPTIONS", "${{ 'BASH_ENV' }}"]);
    expect(unpinnedEnvKeys({ env: "${{ fromJSON(vars.ENV) }}" })).toEqual(["${{ fromJSON(vars.ENV) }}"]);
  });
});

describe("envKeyFindings", () => {
  // `NODE_OPTIONS` on a job, `BASH_ENV` on the aggregator's verdict step.
  it("names the workflow and each job whose own or step env sets an unpinned key, in any job", () => {
    const workflow = {
      env: { YARN_IGNORE_SCRIPTS: "1" },
      jobs: {
        build: { steps: [{ env: { ALL_SUCCEEDED: "true", BASH_ENV: "/p" }, run: "true" }] },
        integration: { env: { NODE_OPTIONS: "--import=x" }, steps: [{ env: { NODE_OPTIONS: "y" }, run: "true" }] },
        site: { steps: [{ run: "true" }] },
      },
    };
    expect(envKeyFindings({ workflow }).map((finding) => finding.line)).toEqual([
      `the workflow \`env\` sets \`YARN_IGNORE_SCRIPTS\`${TAIL}`,
      `\`jobs.build\` sets \`BASH_ENV\`${TAIL}`,
      `\`jobs.integration\` sets \`NODE_OPTIONS\`${TAIL}`,
    ]);
  });

  it("passes the real ci.yml", () => {
    const text = readFileSync(join(repoRootOf({ importMetaUrl: import.meta.url }), CI_WORKFLOW_PATH), "utf8");
    expect(envKeyFindings({ workflow: parse(text) })).toEqual([]);
  });
});
