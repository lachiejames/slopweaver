import { describe, expect, it } from "vitest";

import { BROWSER_WORKFLOW_SEAMS } from "../../../admit/sanctionedBrowserWorkflowSeams.js";
import { CORPUS_LIVE_SEAMS } from "../../../admit/sanctionedCorpusLiveSeams.js";
import { DEV_TOOLING_SEAMS } from "../../../admit/sanctionedDevTooling.js";
import { HOME_ATLAS_SEAMS } from "../../../admit/sanctionedHomeAtlasSeams.js";
import { OPERATIONAL_SEAMS } from "../../../admit/sanctionedOperationalSeams.js";
import { SANCTIONED_SEAMS } from "../../../admit/sanctionedSeams.js";
import { WORKSPACE_SEAMS } from "../../../admit/sanctionedWorkspaceSeams.js";

/*
 * The same properties `talkHatches.test.ts` guards for a register cut into category files: a part dropping out
 * of the one table the scanner reads, and the table's reading order silently changing. What a row's reason says
 * stays `sanctionedSeams.test.ts`'s subject for the whole table.
 */
const PARTS = [
  {
    first: "hooks/pretooluse.ts",
    last: "src/atlas/onepassword/opCli.ts",
    name: "HOME_ATLAS_SEAMS",
    part: HOME_ATLAS_SEAMS,
  },
  {
    first: "src/browser/playwrightCli.ts",
    last: "src/cli/staleSeatEffects.ts",
    name: "BROWSER_WORKFLOW_SEAMS",
    part: BROWSER_WORKFLOW_SEAMS,
  },
  {
    first: "src/cmux/client.ts",
    last: "src/codex/loginExchange.ts",
    name: "WORKSPACE_SEAMS",
    part: WORKSPACE_SEAMS,
  },
  {
    first: "src/config.ts",
    last: "src/live/turn/turnMarkerStore.ts",
    name: "CORPUS_LIVE_SEAMS",
    part: CORPUS_LIVE_SEAMS,
  },
  {
    first: "src/measurement/measure.ts",
    last: "src/environment/gather.ts",
    name: "OPERATIONAL_SEAMS",
    part: OPERATIONAL_SEAMS,
  },
] as const;

describe("the sanctioned-seam category files", () => {
  it("declares five parts, so every guard below is true of something", () => {
    expect(PARTS.length).toBe(5);
  });

  it.each(PARTS)("$name is non-empty and runs from $first to $last", ({ first, last, part }) => {
    const keys = Object.keys(part);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys[0]).toBe(first);
    expect(keys[keys.length - 1]).toBe(last);
  });

  it("is spread into SANCTIONED_SEAMS after the dev-tooling rows, whole, in order and class for class", () => {
    expect(Object.entries(SANCTIONED_SEAMS)).toEqual([
      ...Object.entries(DEV_TOOLING_SEAMS),
      ...Object.entries(HOME_ATLAS_SEAMS),
      ...Object.entries(BROWSER_WORKFLOW_SEAMS),
      ...Object.entries(WORKSPACE_SEAMS),
      ...Object.entries(CORPUS_LIVE_SEAMS),
      ...Object.entries(OPERATIONAL_SEAMS),
    ]);
  });

  it("holds no path in two parts, which a spread silently collapses to one", () => {
    const keys = [...Object.keys(DEV_TOOLING_SEAMS), ...PARTS.flatMap(({ part }) => Object.keys(part))];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
