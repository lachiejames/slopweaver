/**
 * The argv a self-placed Queue card registers with: every field under its own flag, options one per line, the row
 * stated on this machine's own workspace with the caller's reason, and the home last.
 */
import { describe, expect, it } from "vitest";

import { type AskRowFields, askRegisterArgv } from "../../../handover/askRegisterArgv.js";

const ASK: AskRowFields = {
  ask: "Did these five asks get used?",
  blastRadius: "the fleet's own value measure",
  example: "Export the widget report merged on Tuesday. Did it get used?",
  lean: "answer each",
  options: ["used", "unused"],
  problem: "Nobody says whether finished work got used",
  risk: "none",
  slug: "value-sample-2026-w48",
  stillReal: "open until each ask is answered",
};

describe("askRegisterArgv", () => {
  it("spells every field as its flag, on the self workspace, with the home last", () => {
    expect(askRegisterArgv({ ask: ASK, because: "the fleet's own value measure", home: "/h" })).toEqual([
      "node",
      "slopweaver",
      "handover",
      "register",
      "--ask",
      "Did these five asks get used?",
      "--slug",
      "value-sample-2026-w48",
      "--problem",
      "Nobody says whether finished work got used",
      "--options",
      "used\nunused",
      "--lean",
      "answer each",
      "--risk",
      "none",
      "--blast-radius",
      "the fleet's own value measure",
      "--still-real",
      "open until each ask is answered",
      "--example",
      "Export the widget report merged on Tuesday. Did it get used?",
      "--workspace",
      "self",
      "--workspace-because",
      "the fleet's own value measure",
      "--home",
      "/h",
    ]);
  });

  it("passes one option through without a separator", () => {
    const argv = askRegisterArgv({ ask: { ...ASK, options: ["used"] }, because: "b", home: "/h" });
    expect(argv[argv.indexOf("--options") + 1]).toBe("used");
  });
});
