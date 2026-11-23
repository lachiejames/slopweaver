import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseVoiceShapeMemory } from "../../../../outbound/voice/shapeMemory.js";

/** A well-formed response-shape memory, with neutral fixture prose rather than any operator's own words. */
const VALID = [
  "---",
  "name: fixture-response-shape",
  "description: how a fixture reply should read",
  "metadata:",
  "  type: feedback",
  "---",
  "",
  "**One line by default.**",
  "",
  "Lead with the outcome.",
  "",
].join("\n");

describe("parseVoiceShapeMemory", () => {
  it("returns the body with its internal blank lines intact and the surrounding ones trimmed", () => {
    const result = parseVoiceShapeMemory({ file: "/m/fixture.md", text: VALID });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe("**One line by default.**\n\nLead with the outcome.");
  });

  it("reads a file written with CRLF line endings and a BOM", () => {
    const result = parseVoiceShapeMemory({ file: "/m/fixture.md", text: `﻿${VALID.replaceAll("\n", "\r\n")}` });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe("**One line by default.**\n\nLead with the outcome.");
  });

  it("keeps indentation on the first content line, so an indented example stays an example", () => {
    // The indentation counterexample: a whole-body `.trim()` stripped the four spaces in front of
    // an indented Markdown example, turning a code block into a bullet in the operator's own guidance.
    const text = [
      "---",
      "name: fixture",
      "description: guidance",
      "metadata:",
      "  type: feedback",
      "---",
      "",
      "    - Example wording, not a bullet instruction.",
      "",
      "Keep examples verbatim.",
      "",
    ].join("\n");

    const result = parseVoiceShapeMemory({ file: "/m/indented.md", text });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe("    - Example wording, not a bullet instruction.\n\nKeep examples verbatim.");
  });

  it("refuses a file with no frontmatter at all, naming the file", () => {
    const result = parseVoiceShapeMemory({ file: "/m/bare.md", text: "Just prose.\n" });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(["/m/bare.md: frontmatter is missing or never closed"]);
  });

  it("refuses frontmatter that is never closed", () => {
    const result = parseVoiceShapeMemory({ file: "/m/open.md", text: "---\nname: x\n\nBody.\n" });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(["/m/open.md: frontmatter is missing or never closed"]);
  });

  it("refuses a duplicate YAML key rather than silently taking one of them", () => {
    const text = "---\nname: a\nname: b\ndescription: d\n---\n\nBody.\n";

    const result = parseVoiceShapeMemory({ file: "/m/dupe.md", text });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("frontmatter is not valid YAML");
  });

  it("refuses a memory missing its required description", () => {
    const text = "---\nname: fixture\n---\n\nBody.\n";

    const result = parseVoiceShapeMemory({ file: "/m/thin.md", text });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain("/m/thin.md: frontmatter is missing `description`");
  });

  it("refuses a valid memory whose body is empty, because there is no guidance to print", () => {
    const text = "---\nname: fixture\ndescription: d\nmetadata:\n  type: feedback\n---\n\n   \n";

    const result = parseVoiceShapeMemory({ file: "/m/empty.md", text });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual([
      "/m/empty.md: the memory has valid frontmatter and an empty body, so there is no guidance to print",
    ]);
  });
});
