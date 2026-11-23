import { describe, expect, it } from "vitest";
import type { RunHistoryDocument } from "../../../../live/github/runHistory.js";
import { summariseJobDurations } from "../../../../live/github/runHistory.js";
import {
  CI_BAR_MINUTES,
  durationLabel,
  renderRunHistoryJson,
  renderRunHistoryText,
} from "../../../../live/github/runHistoryReport.js";

function documentOf({ residue }: { residue: readonly string[] }): RunHistoryDocument {
  return {
    branch: "main",
    event: "push",
    jobs: summariseJobDurations({
      timings: [
        {
          conclusion: "success",
          dependencyBlocked: false,
          name: "lint",
          queueSeconds: 12,
          runId: 1,
          skipped: false,
          steps: [],
          totalSeconds: 462,
          wallSeconds: 450,
        },
        {
          conclusion: "success",
          dependencyBlocked: true,
          name: "build",
          queueSeconds: 460,
          runId: 1,
          skipped: false,
          steps: [],
          totalSeconds: 465,
          wallSeconds: 5,
        },
      ],
    }),
    readAtIso: "2026-09-20T00:00:00.000Z",
    repo: "lachiejames/slopweaver",
    residue,
    runs: [
      {
        conclusion: "success",
        createdAtIso: "2026-09-19T10:00:00Z",
        event: "push",
        headSha: "a1b2c3d4",
        id: 1,
        runNumber: 101,
        status: "completed",
        url: "https://github.com/lachiejames/slopweaver/actions/runs/1",
      },
    ],
    source: "github",
    steps: [],
    stepsRequested: false,
    workflow: "ci.yml",
  };
}

describe("durationLabel", () => {
  it("writes a duration as m:ss", () => {
    expect(durationLabel({ seconds: 450 })).toBe("7:30");
    expect(durationLabel({ seconds: 5 })).toBe("0:05");
  });

  it("writes a dash for an unmeasured duration rather than a zero", () => {
    expect(durationLabel({ seconds: undefined })).toBe("—");
  });
});

describe("renderRunHistoryText", () => {
  it("flags the job over the bar and leaves the one under it alone", () => {
    const text = renderRunHistoryText({ document: documentOf({ residue: [] }) });
    expect(text).toContain("OVER  lint");
    expect(text).toContain("ok    build");
  });

  it("prints (needs) instead of a queue number for a dependency-blocked job", () => {
    expect(renderRunHistoryText({ document: documentOf({ residue: [] }) })).toContain("(needs)");
  });

  it("names the bar it judged against", () => {
    expect(renderRunHistoryText({ document: documentOf({ residue: [] }) })).toContain(
      `bar ${String(CI_BAR_MINUTES)}:00 wall`,
    );
  });

  it("prints the residue when there is one", () => {
    const text = renderRunHistoryText({ document: documentOf({ residue: ["run 102: 403 forbidden"] }) });
    expect(text).toContain("residue:");
    expect(text).toContain("run 102: 403 forbidden");
  });

  it("prints no residue heading when there is none", () => {
    expect(renderRunHistoryText({ document: documentOf({ residue: [] }) })).not.toContain("residue:");
  });
});

describe("renderRunHistoryJson", () => {
  it("emits the document a later measurement diffs against", () => {
    const json = renderRunHistoryJson({ document: documentOf({ residue: [] }) });
    expect(json).toContain('"repo": "lachiejames/slopweaver"');
    expect(json).toContain('"wallP95Seconds": 450');
  });
});

describe("a job with no sample", () => {
  function skippedDocument(): RunHistoryDocument {
    const base = documentOf({ residue: [] });
    return {
      ...base,
      jobs: summariseJobDurations({
        timings: [
          {
            conclusion: "skipped",
            dependencyBlocked: false,
            name: "integration",
            queueSeconds: undefined,
            runId: 1,
            skipped: true,
            steps: [],
            totalSeconds: undefined,
            wallSeconds: undefined,
          },
        ],
      }),
    };
  }

  it("reads n/m rather than ok, so an unrun check is not presented as a passing one", () => {
    const text = renderRunHistoryText({ document: skippedDocument() });
    expect(text).toContain("n/m   integration");
    expect(text).not.toContain("ok    integration");
  });

  it("says the event does not trigger it, and that this proves nothing about its duration", () => {
    const text = renderRunHistoryText({ document: skippedDocument() });
    expect(text).toContain("SKIPPED in 1 of 1 run(s)");
    expect(text).toContain("nothing here says how long it takes");
  });
});
