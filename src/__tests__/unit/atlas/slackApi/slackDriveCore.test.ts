import { describe, expect, it } from "vitest";

import type { SurfaceComparison } from "../../../../atlas/slackApi/disagreement.js";
import { AtlasCommandErrors } from "../../../../cli/commands/atlas/errors.js";
import {
  ATLAS_SLACK_DRIVE_FLAG_NAMES,
  DISAGREEMENT_ROW_CAP,
  parseAtlasSlackDriveArgs,
  renderDriveReport,
  renderDriveSummary,
} from "../../../../cli/commands/atlas/slackDriveCore.js";
import { ATLAS_SLACK_DRIVE_USAGE } from "../../../../cli/commands/atlas/slackUsage.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const SUMMARY = {
  apiOnly: 3,
  both: 2,
  browserOnly: 1,
  methods: 6,
  withUndocumentedParams: 1,
  withUndocumentedResponseFields: 2,
};

function row(over: Partial<SurfaceComparison> = {}): SurfaceComparison {
  return {
    callCount: 2,
    method: "conversations.history",
    paramsBrowserOnly: ["include_tombstones"],
    pathsApiOnly: [],
    pathsBrowserOnly: ["messages[].blocks"],
    verdict: "both",
    ...over,
  };
}

describe("parseAtlasSlackDriveArgs", () => {
  it("has at least one entry in ATLAS_SLACK_DRIVE_FLAG_NAMES, so the guards below are not vacuously green", () => {
    expect(ATLAS_SLACK_DRIVE_FLAG_NAMES.length).toBeGreaterThan(0);
  });

  it("defaults to the read-only report, so a bare invocation never opens a browser", () => {
    expect(unwrap(parseAtlasSlackDriveArgs({ rest: [] })).verb).toBe("report");
  });

  it("accepts plan, which needs nothing else", () => {
    expect(unwrap(parseAtlasSlackDriveArgs({ rest: ["plan"] })).verb).toBe("plan");
  });

  it("accepts sync when it is told which walk document to publish from", () => {
    const options = unwrap(parseAtlasSlackDriveArgs({ rest: ["sync", "--session", "/tmp/walk.json"] }));
    expect(options.verb).toBe("sync");
    expect(options.session).toBe("/tmp/walk.json");
  });

  it("refuses sync with no --session, because there is no browser for it to drive", () => {
    expect(unwrapErr(parseAtlasSlackDriveArgs({ rest: ["sync"] }))).toEqual(
      AtlasCommandErrors.slackDriveSessionMisused(),
    );
    expect(unwrapErr(parseAtlasSlackDriveArgs({ rest: ["sync"] })).message).toContain("needs --session");
  });

  it("accepts refresh, the unattended half, which takes no walk document", () => {
    expect(unwrap(parseAtlasSlackDriveArgs({ rest: ["refresh"] })).verb).toBe("refresh");
  });

  it("refuses refresh handed a walk document, because that document belongs to sync", () => {
    expect(unwrapErr(parseAtlasSlackDriveArgs({ rest: ["refresh", "--session", "/tmp/walk.json"] })).message).toBe(
      "`slack-drive sync` needs --session <path>, the walk document `slack-drive plan` briefed, and " +
        "`slack-drive refresh` reads no walk document at all — it is the unattended half",
    );
  });

  it("rejects a sub-verb it does not have", () => {
    expect(unwrapErr(parseAtlasSlackDriveArgs({ rest: ["drive"] }))).toEqual(
      AtlasCommandErrors.slackDriveVerbUnknown({ verb: "drive" }),
    );
    expect(unwrapErr(parseAtlasSlackDriveArgs({ rest: ["drive"] })).message).toBe(
      "unknown sub-verb drive — this verb takes plan, sync, refresh or report",
    );
  });

  it("reads --dry-run and --json", () => {
    const options = unwrap(parseAtlasSlackDriveArgs({ rest: ["sync", "--session", "-", "--dry-run", "--json"] }));
    expect(options.dryRun).toBe(true);
    expect(options.json).toBe(true);
  });

  it("treats an empty --home as absent rather than as the root directory", () => {
    expect(unwrap(parseAtlasSlackDriveArgs({ rest: ["report", "--home", ""] })).home).toBe(undefined);
  });

  it("names every flag it accepts in its own usage line", () => {
    for (const flag of ATLAS_SLACK_DRIVE_FLAG_NAMES) {
      expect(ATLAS_SLACK_DRIVE_USAGE).toContain(flag);
    }
  });
});

describe("renderDriveSummary", () => {
  it("states every count, including the ones that agree", () => {
    expect(renderDriveSummary({ summary: SUMMARY })).toEqual([
      "6 method(s) held across both surfaces",
      "  2 seen by BOTH the installed SDK and the driven browser",
      "  3 declared by the SDK that this session's web client never called",
      "  1 called by the web client that the SDK does not declare — the undocumented surface",
      "1 method(s) sent a parameter the SDK does not declare",
      "2 method(s) returned a response field the SDK does not declare",
    ]);
  });
});

describe("renderDriveReport", () => {
  it("names the parameters and fields one surface has and the other does not", () => {
    const report = renderDriveReport({ comparisons: [row()], summary: SUMMARY });
    expect(report).toContain("params: include_tombstones");
    expect(report).toContain("fields: messages[].blocks");
  });

  it("says how many times a browser-only method was actually called", () => {
    const report = renderDriveReport({
      comparisons: [
        row({ method: "client.counts", paramsBrowserOnly: [], pathsBrowserOnly: [], verdict: "browser-only" }),
      ],
      summary: SUMMARY,
    });
    expect(report).toContain("client.counts — browser only, called 2x");
  });

  it("resolves nothing, and says so — which surface wins is the owner's reserved call", () => {
    expect(renderDriveReport({ comparisons: [row()], summary: SUMMARY })).toContain("nothing above is resolved");
  });

  it("caps the printed rows and says how many it did not print", () => {
    const many = Array.from({ length: DISAGREEMENT_ROW_CAP + 5 }, (_unused, index) =>
      row({ method: `m.${String(index)}` }),
    );
    expect(renderDriveReport({ comparisons: many, summary: SUMMARY })).toContain("and 5 more");
  });

  it("reports an honest zero when the two surfaces agree everywhere", () => {
    const agreeing = renderDriveReport({
      comparisons: [row({ paramsBrowserOnly: [], pathsBrowserOnly: [] })],
      summary: SUMMARY,
    });
    expect(agreeing).toContain("0 method(s) where the two surfaces disagree");
  });
});
