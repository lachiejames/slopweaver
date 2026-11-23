import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseDocDiffRecord } from "../../../../policy/diff/record.js";
import { recordText } from "./fixture.js";

describe("parseDocDiffRecord", () => {
  it("accepts the fixture record", () => {
    const record = unwrap(parseDocDiffRecord({ text: recordText() }));
    expect(record.documents[0]!.id).toBe("network");
    expect(record.keyChanges.length).toBe(3);
  });

  it("refuses two key changes: the team post is three dot points", () => {
    const issues = unwrapErr(parseDocDiffRecord({ text: recordText({ overrides: { keyChanges: ["one", "two"] } }) }));
    expect(issues[0]!.code).toBe("INVALID_RECORD");
    expect(issues[0]!.message).toContain("keyChanges");
  });

  it("refuses a link target that is neither https nor a Vanta id", () => {
    const issues = unwrapErr(
      parseDocDiffRecord({ text: recordText({ overrides: { links: [{ target: "http://x.test", text: "x" }] } }) }),
    );
    expect(issues[0]!.message).toContain("links.0.target");
  });

  it("refuses a repository that is not owner/repo", () => {
    const issues = unwrapErr(parseDocDiffRecord({ text: recordText({ overrides: { repository: "acme-admin" } }) }));
    expect(issues[0]!.message).toContain("repository");
  });

  it("refuses an entry id used twice in one document", () => {
    const record = JSON.parse(recordText()) as { documents: { marks: { id: string }[] }[] };
    record.documents[0]!.marks[0]!.id = "refresh";
    const issues = unwrapErr(parseDocDiffRecord({ text: JSON.stringify(record) }));
    expect(issues.map((issue) => issue.message)).toEqual([
      "the diff record is not valid: network: entry id refresh appears twice",
    ]);
  });

  it("refuses a match string that is empty as plain text, since it would claim every line", () => {
    const record = JSON.parse(recordText()) as { documents: { changes: { match: string[] }[] }[] };
    record.documents[0]!.changes[0]!.match = ["**"];
    const issues = unwrapErr(parseDocDiffRecord({ text: JSON.stringify(record) }));
    expect(issues.map((issue) => issue.message)).toEqual([
      'the diff record is not valid: network: entry refresh matches "**", which is empty as plain text and so matches every line',
    ]);
  });

  it("refuses text that is not JSON", () => {
    const issues = unwrapErr(parseDocDiffRecord({ text: "{" }));
    expect(issues[0]!.code).toBe("INVALID_RECORD");
  });
});
