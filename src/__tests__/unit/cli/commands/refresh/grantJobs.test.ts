/**
 * The grant-riding `refresh` lanes (`cli/commands/refresh/grantJobs.ts`): the Outlook diary's builder hands its
 * caps, window and cursor override through unchanged, resolves no seam itself, and a build without the lane is
 * refused by name rather than skipped.
 */
import { describe, expect, it } from "vitest";

import { buildOutlookCalendarSourceJob } from "../../../../../cli/commands/refresh/grantJobs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { ALL_WIRED, fakeDeps, HOME, job, NOW_ISO, options } from "./jobPlan/fakeDeps.js";

const WINDOW = { since: "2026-01-01", until: "2026-03-15" };

describe("buildOutlookCalendarSourceJob", () => {
  it("hands the caps, the window and the override through, and leaves the seam to the grant", () => {
    const seen: unknown[] = [];
    const built = job({ label: "outlook-calendar (diary)", source: "outlook-calendar", window: WINDOW });
    const deps = {
      ...fakeDeps({ jobs: {}, wired: ALL_WIRED }).deps,
      buildOutlookCalendarJob: (args: { nowIso: () => string } & Record<string, unknown>) => {
        seen.push({ ...args, nowIso: args.nowIso() });
        return built;
      },
    };

    const result = buildOutlookCalendarSourceJob({
      cursorOverridden: true,
      deps,
      home: HOME,
      options: options({ rest: ["--sample", "3"] }),
      window: WINDOW,
    });

    expect(unwrap(result)).toBe(built);
    expect(seen).toStrictEqual([
      {
        api: undefined,
        cursorOverridden: true,
        fetchCap: undefined,
        home: HOME,
        nowIso: NOW_ISO,
        sample: 3,
        window: WINDOW,
      },
    ]);
  });

  it("refuses by name when this build has no Outlook diary lane", () => {
    const result = buildOutlookCalendarSourceJob({
      cursorOverridden: false,
      deps: fakeDeps({ jobs: {}, wired: ALL_WIRED }).deps,
      home: HOME,
      options: options({ rest: [] }),
      window: WINDOW,
    });

    expect(unwrapErr(result).code).toBe("LANE_NOT_WIRED");
  });
});
