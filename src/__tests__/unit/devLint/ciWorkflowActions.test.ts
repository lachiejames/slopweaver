import { describe, expect, it } from "vitest";
import {
  RUNNER_SELECTOR,
  SPECIAL_WORKFLOW_RUNNERS,
  staleSpecialRunnerFindings,
} from "../../../devLint/ciRunnerFacts.js";
import { workflowActionFindings } from "../../../devLint/ciWorkflowActions.js";

const CI = ".github/workflows/ci.yml";
const RELEASE = ".github/workflows/desktop-release.yml";
const OTHER = ".github/workflows/pr-cache.yml";

/** The findings for one workflow file at `path`. */
const findingsFor = ({ path, text }: { path: string; text: string }): readonly string[] =>
  workflowActionFindings({ cacheWorkflow: CI, workflows: [{ path, text }] }).map((finding) => finding.line);

const stepsUsing = ({ uses }: { uses: string }): string =>
  [
    "jobs:",
    "  a:",
    `    runs-on: ${RUNNER_SELECTOR}`,
    "    steps:",
    "      - uses: actions/checkout@v7",
    `      - uses: ${uses}`,
  ].join("\n");

describe("workflowActionFindings", () => {
  it("passes the pinned actions and the cache pair in the cache workflow", () => {
    expect(findingsFor({ path: CI, text: stepsUsing({ uses: "actions/cache/save@v4" }) })).toEqual([]);
    expect(findingsFor({ path: OTHER, text: stepsUsing({ uses: "actions/upload-artifact@v4" }) })).toEqual([]);
  });

  it("refuses a cache action in any other workflow, whatever its spelling", () => {
    expect(findingsFor({ path: OTHER, text: stepsUsing({ uses: "Actions/Cache/Save/@v4" }) })).toEqual([
      `\`${OTHER}\` uses \`actions/cache/save\`, and only \`${CI}\` may touch the dependency cache — a save anywhere else shares its key`,
    ]);
  });

  it("refuses an action outside the pinned set, in the cache workflow too", () => {
    expect(findingsFor({ path: CI, text: stepsUsing({ uses: "someone/cache-wrapper@v1" }) })).toEqual([
      `\`${CI}\` uses \`someone/cache-wrapper\`, outside WORKFLOW_ACTIONS (ciWorkflowActions.ts), which could save the dependency cache where ci-offload-contract cannot see it`,
    ]);
    expect(findingsFor({ path: CI, text: stepsUsing({ uses: "actions/cache@v4" }) })).toEqual([
      `\`${CI}\` uses \`actions/cache\`, outside WORKFLOW_ACTIONS (ciWorkflowActions.ts), which could save the dependency cache where ci-offload-contract cannot see it`,
    ]);
  });

  it("refuses a local action and a reusable workflow a job calls", () => {
    const text = [
      "jobs:",
      "  a:",
      `    runs-on: ${RUNNER_SELECTOR}`,
      "    uses: ./.github/workflows/save.yml",
      "  b:",
      `    runs-on: ${RUNNER_SELECTOR}`,
      "    steps:",
      "      - uses: ./.github/actions/save",
    ].join("\n");
    expect(findingsFor({ path: OTHER, text }).length).toBe(2);
    expect(findingsFor({ path: OTHER, text })[0]).toContain("`./.github/workflows/save.yml`, outside WORKFLOW_ACTIONS");
    expect(findingsFor({ path: OTHER, text })[1]).toContain("`./.github/actions/save`, outside WORKFLOW_ACTIONS");
  });

  it("refuses a uses it cannot read as a string", () => {
    expect(
      findingsFor({
        path: OTHER,
        text: `jobs:\n  a:\n    runs-on: ${RUNNER_SELECTOR}\n    steps:\n      - uses: [actions/cache/save]\n`,
      }),
    ).toEqual([`\`${OTHER}\` has a \`uses\` that is not a string, which no pinned action can match`]);
  });

  it("pins setup-node's inputs whole, so its own cache input cannot write an entry (pin-16)", () => {
    const setupNode = ({ inputs }: { inputs: readonly string[] }): string =>
      [
        "jobs:",
        "  a:",
        `    runs-on: ${RUNNER_SELECTOR}`,
        "    steps:",
        "      - uses: actions/setup-node@v7",
        "        with:",
        ...inputs.map((input) => `          ${input}`),
      ].join("\n");
    expect(findingsFor({ path: OTHER, text: setupNode({ inputs: ['node-version-file: ".nvmrc"'] }) })).toEqual([]);
    expect(
      findingsFor({ path: OTHER, text: setupNode({ inputs: ['node-version-file: ".nvmrc"', "cache: yarn"] }) }),
    ).toEqual([
      `\`${OTHER}\` runs \`actions/setup-node\` with inputs other than exactly {"node-version-file":".nvmrc"}, and its \`cache\` input writes a cache of its own`,
    ]);
  });

  // Written out rather than read from the constant, so a wrong selector fails here instead of agreeing with itself.
  const selector =
    "${{ fromJSON(github.event.repository.owner.type == 'Organization' && '{\"group\":\"default\"}' || github.event.repository.owner.type == 'User' && '\"ubuntu-latest\"' || '') }}";

  it("selects the default group for an organisation and ubuntu-latest for a personal account, failing anything else", () => {
    expect(RUNNER_SELECTOR).toBe(selector);
  });

  it("names any job off the one runner selector, in every workflow file (pin-14, pin-15)", () => {
    const text = ["jobs:", "  a:", "    runs-on: ubuntu-latest", "  b:", "    steps: []"].join("\n");
    expect(findingsFor({ path: OTHER, text })).toEqual([
      `\`${OTHER}\` \`jobs.a\` does not run on exactly \`${selector}\` (RUNNER_SELECTOR), so it could pick a runner whose own environment runs before any step`,
      `\`${OTHER}\` \`jobs.b\` does not run on exactly \`${selector}\` (RUNNER_SELECTOR), so it could pick a runner whose own environment runs before any step`,
    ]);
  });

  it("lets the desktop release job, and only it, run on its registered macOS label", () => {
    const text = ["jobs:", "  release:", "    runs-on: macos-15", "  other:", "    runs-on: macos-15"].join("\n");
    expect(findingsFor({ path: RELEASE, text })).toEqual([
      `\`${RELEASE}\` \`jobs.other\` does not run on exactly \`${selector}\` (RUNNER_SELECTOR), so it could pick a runner whose own environment runs before any step`,
    ]);
    expect(findingsFor({ path: CI, text: ["jobs:", "  release:", "    runs-on: macos-15"].join("\n") })).toEqual([
      `\`${CI}\` \`jobs.release\` does not run on exactly \`${selector}\` (RUNNER_SELECTOR), so it could pick a runner whose own environment runs before any step`,
    ]);
  });

  it("refuses the release job on any label but its registered one", () => {
    const text = ["jobs:", "  release:", "    runs-on: macos-latest"].join("\n");
    expect(findingsFor({ path: RELEASE, text })).toEqual([
      `\`${RELEASE}\` \`jobs.release\` does not run on exactly \`macos-15\` (SPECIAL_WORKFLOW_RUNNERS), so it could pick a runner whose own environment runs before any step`,
    ]);
  });

  it("names a special runner row whose workflow file or job is gone", () => {
    const stale = `SPECIAL_WORKFLOW_RUNNERS names \`${RELEASE}\` \`jobs.release\`, which no workflow carries — drop the row`;
    expect(SPECIAL_WORKFLOW_RUNNERS.length).toBeGreaterThan(0);
    expect(staleSpecialRunnerFindings({ workflows: [] }).map((each) => each.line)).toEqual([stale]);
    const renamed = { path: RELEASE, text: "jobs:\n  publish:\n    runs-on: macos-15\n" };
    expect(staleSpecialRunnerFindings({ workflows: [renamed] }).map((each) => each.line)).toEqual([stale]);
    const unparsed = { path: RELEASE, text: "jobs: [" };
    expect(staleSpecialRunnerFindings({ workflows: [unparsed] }).map((each) => each.line)).toEqual([stale]);
    const present = { path: RELEASE, text: "jobs:\n  release:\n    runs-on: macos-15\n" };
    expect(staleSpecialRunnerFindings({ workflows: [present] })).toEqual([]);
  });

  it("reports a file that does not parse as unevaluated", () => {
    const findings = workflowActionFindings({ cacheWorkflow: CI, workflows: [{ path: OTHER, text: "jobs: [" }] });
    expect(findings.length).toBe(1);
    expect(findings[0]!.unevaluated).toBe(true);
  });
});
