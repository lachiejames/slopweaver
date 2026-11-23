/*
 * `linearIssueFieldsSchema`, the issue's own fields: a title and a team are the minimum, priority sits on
 * Linear's global scale, priority, estimate and state stay optional, and a line ending in the title or
 * assignee is refused while the title's words are not policed.
 */
import { describe, expect, it } from "vitest";

import { linearIssueFieldsSchema } from "../../../../../outbound/linear/schema.js";
import { firstMessage } from "./harness.js";

describe("linearIssueFieldsSchema", () => {
  const base = { teamId: "00000000-0000-4000-8000-000000000001", title: "A real title" };

  it("accepts the minimum: a title and a team", () => {
    expect(linearIssueFieldsSchema.safeParse(base).success).toBe(true);
  });

  it("refuses a team KEY, naming the verb that would print its UUID without claiming the team exists", () => {
    const result = linearIssueFieldsSchema.safeParse({ ...base, teamId: "ABC" });
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toBe(
      'teamId "ABC" is not a team UUID, and a team key is not accepted; ' +
        "if ABC is a team's key, `slopweaver linear states --team ABC` prints its UUID",
    );
  });

  it("names no team in the command for a value that is not even key-shaped, empty included", () => {
    const messages = ["", "team-1"].map((teamId) =>
      firstMessage({ result: linearIssueFieldsSchema.safeParse({ ...base, teamId }) }),
    );
    expect(messages).toEqual([
      'teamId "" is not a team UUID; `slopweaver linear states --team <team-key>` prints it',
      'teamId "team-1" is not a team UUID; `slopweaver linear states --team <team-key>` prints it',
    ]);
  });

  it("refuses a value that is only UUID-SHAPED: version 0, a non-RFC variant, and the nil UUID", () => {
    const accepted = [
      "00000000-0000-0000-8000-000000000001",
      "00000000-0000-4000-0000-000000000001",
      "00000000-0000-0000-0000-000000000000",
    ].map((teamId) => linearIssueFieldsSchema.safeParse({ ...base, teamId }).success);
    expect(accepted).toEqual([false, false, false]);
  });

  it("accepts a team UUID in capitals and of any version, since Linear's contract is only 'a UUID'", () => {
    const accepted = ["00000000-0000-4000-8000-0000000000AB", "00000000-0000-1000-8000-000000000001"].map(
      (teamId) => linearIssueFieldsSchema.safeParse({ ...base, teamId }).success,
    );
    expect(accepted).toEqual([true, true]);
  });

  it("accepts every global priority value", () => {
    for (const priority of [0, 1, 2, 3, 4]) {
      expect(linearIssueFieldsSchema.safeParse({ ...base, priority }).success).toBe(true);
    }
  });

  it("refuses a priority outside Linear's global scale", () => {
    expect(linearIssueFieldsSchema.safeParse({ ...base, priority: 5 }).success).toBe(false);
  });

  it("leaves priority, estimate and state OPTIONAL so a ticket can land in triage", () => {
    const result = linearIssueFieldsSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data!.priority).toBe(undefined);
    expect(result.data!.estimate).toBe(undefined);
    expect(result.data!.stateId).toBe(undefined);
  });

  it("does not constrain the estimate to one team's scale", () => {
    // Fibonacci 8 and t-shirt 3 are both valid; the destination team decides, not this file.
    expect(linearIssueFieldsSchema.safeParse({ ...base, estimate: 8 }).success).toBe(true);
    expect(linearIssueFieldsSchema.safeParse({ ...base, estimate: 3 }).success).toBe(true);
  });

  it("refuses a newline in the title, which Linear would drop silently", () => {
    const result = linearIssueFieldsSchema.safeParse({ ...base, title: "One\nTwo" });
    expect(result.success).toBe(false);
    expect(firstMessage({ result })).toContain("single line");
  });

  it("refuses every other line ending in the title or assignee too, a vertical tab and NEL included", () => {
    const messages = [0x0b, 0x85, 0x2028].flatMap((code) => {
      const split = `One${String.fromCodePoint(code)}Two`;
      return [
        firstMessage({ result: linearIssueFieldsSchema.safeParse({ ...base, title: split }) }),
        firstMessage({ result: linearIssueFieldsSchema.safeParse({ ...base, assignee: split }) }),
      ].map((message) => message.includes("one line") || message.includes("single line"));
    });
    expect(messages).toEqual([true, true, true, true, true, true]);
  });

  it("does not police the words in a title", () => {
    expect(linearIssueFieldsSchema.safeParse({ ...base, title: "Fix the board — six defects" }).success).toBe(true);
  });
});
