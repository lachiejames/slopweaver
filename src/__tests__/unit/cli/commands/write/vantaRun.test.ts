import { describe, expect, it } from "vitest";

import { runWriteVanta, WRITE_VANTA_USAGE, WRITE_VANTA_VERBS } from "../../../../../cli/commands/write/vantaRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** argv as the CLI receives it for a platform verb: runtime, script, noun, platform, then the verb. */
function argvOf({ noun, tail }: { noun: string; tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", noun, "vanta", ...tail];
}

describe("write vanta", () => {
  // Every one of these is a mutation, which is exactly why none of them is reachable under `atlas vanta`.
  it("answers exactly the mutations the atlas refuses", () => {
    expect([...WRITE_VANTA_VERBS]).toEqual([
      "create-document",
      "deactivate",
      "edit-policy-draft",
      "group-people",
      "reactivate",
      "submit-document",
      "upload-evidence",
      "upload-policy-version",
    ]);
    expect(WRITE_VANTA_USAGE).toBe(
      "usage: slopweaver write vanta <create-document | deactivate | edit-policy-draft | group-people | reactivate | submit-document | upload-evidence | upload-policy-version>",
    );
  });

  // `writeClient.ts` implements both, and `writePreview.ts` deliberately previews neither — so neither is
  // reachable. This asserts that standing decision rather than leaving it to a header nothing checks.
  it("reaches neither destructive document write", () => {
    expect(WRITE_VANTA_VERBS.includes("delete-document")).toBe(false);
    expect(WRITE_VANTA_VERBS.includes("delete-upload")).toBe(false);
  });

  it("refuses a verb it does not have", async () => {
    expect(await runWriteVanta(argvOf({ noun: "write", tail: ["sync"] }))).toBe(EXIT_USAGE);
  });

  it("refuses with no verb at all", async () => {
    expect(await runWriteVanta(argvOf({ noun: "write", tail: [] }))).toBe(EXIT_USAGE);
  });

  it("prints usage for help", async () => {
    expect(await runWriteVanta(argvOf({ noun: "write", tail: ["--help"] }))).toBe(EXIT_OK);
  });
});
