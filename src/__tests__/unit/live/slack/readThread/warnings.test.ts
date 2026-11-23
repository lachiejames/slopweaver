/*
 * The `slack read-thread` document's stage warnings: a stage verdict with something to say becomes exactly one
 * sentence, and one with nothing to say becomes none.
 */
import { describe, expect, it } from "vitest";

import { deriveThreadCompleteness, type UnretrievableFile } from "../../../../../live/slack/completeness.js";
import type { FileOutcome } from "../../../../../live/slack/fileDownloads.js";
import {
  completenessWarnings,
  scopeWarnings,
  unretrievableWarnings,
} from "../../../../../live/slack/readThreadWarnings.js";

const LOST: UnretrievableFile = {
  detail: "HTTP 403",
  fileId: "F0FIXTURE01",
  messageTs: "1700000000.000100",
  method: "slack.files.download",
  reason: "download-failed",
};

/**
 * An attachment outcome that lost exactly the files named.
 *
 * @returns the outcome, with nothing retrieved, skipped or limited
 */
function outcomeLosing({ unretrievable }: { unretrievable: readonly UnretrievableFile[] }): FileOutcome {
  return { limitations: [], retrieved: [], skipped: [], unretrievable };
}

describe("scopeWarnings", () => {
  it("says nothing when the token demonstrably holds the file scope", () => {
    expect(
      scopeWarnings({
        preflight: { downloadsAtRisk: 0, granted: ["files:read"], missing: [], verdict: "sufficient" },
      }),
    ).toEqual([]);
  });

  it("carries one sentence when the scope set could not be established", () => {
    const warnings = scopeWarnings({
      preflight: { downloadsAtRisk: 0, granted: null, missing: [], verdict: "undetermined" },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("could not be established");
  });

  it("names the missing scope and the downloads it put at risk", () => {
    const warnings = scopeWarnings({
      preflight: { downloadsAtRisk: 3, granted: ["chat:write"], missing: ["files:read"], verdict: "insufficient" },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("missing the Slack scope(s) files:read");
    expect(warnings[0]).toContain("3 attachment(s) were NOT downloaded");
  });
});

describe("unretrievableWarnings", () => {
  it("says nothing when no attachment was lost", () => {
    expect(unretrievableWarnings({ files: outcomeLosing({ unretrievable: [] }) })).toEqual([]);
  });

  it("names one lost attachment in the singular", () => {
    expect(unretrievableWarnings({ files: outcomeLosing({ unretrievable: [LOST] }) })).toEqual([
      "1 attachment could NOT be retrieved and their content is absent from this read; " +
        "each is named in the limitations below and beside the message that carried it",
    ]);
  });

  it("counts several lost attachments in the plural", () => {
    const warnings = unretrievableWarnings({
      files: outcomeLosing({ unretrievable: [LOST, { ...LOST, fileId: "F0FIXTURE02" }] }),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("2 attachments could NOT be retrieved");
  });
});

describe("completenessWarnings", () => {
  it("says nothing when the held count matches Slack's advertised one", () => {
    const completeness = deriveThreadCompleteness({
      held: 2,
      rawMessages: [
        { reply_count: 1, ts: "1700000000.000100" },
        { thread_ts: "1700000000.000100", ts: "1700000100.000200" },
      ],
      threadTs: "1700000000.000100",
    });
    expect(completeness.verdict).toBe("corroborated");
    expect(completenessWarnings({ completeness })).toEqual([]);
  });

  it("says nothing when Slack advertised no count to compare against", () => {
    const completeness = deriveThreadCompleteness({
      held: 1,
      rawMessages: [{ ts: "1700000000.000100" }],
      threadTs: "1700000000.000100",
    });
    expect(completeness.verdict).toBe("unverified");
    expect(completenessWarnings({ completeness })).toEqual([]);
  });

  it("carries one caveat when Slack advertises more than the read holds", () => {
    const completeness = deriveThreadCompleteness({
      held: 2,
      rawMessages: [
        { reply_count: 4, ts: "1700000000.000100" },
        { thread_ts: "1700000000.000100", ts: "1700000100.000200" },
      ],
      threadTs: "1700000000.000100",
    });
    const warnings = completenessWarnings({ completeness });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("advertises 5 messages and this read holds 2");
  });
});
