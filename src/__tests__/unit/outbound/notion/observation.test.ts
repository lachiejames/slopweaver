/**
 * A render observation parsed from the document the measurement script returned: a full document and an older
 * one without text blocks both parse to exactly what was written, while an undeclared key and malformed JSON
 * are refused as OBSERVATION_UNREADABLE naming the file — never defaulted to a clean, empty page.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseObservation } from "../../../../outbound/notion/observation.js";
import { NotionVerifyErrors } from "../../../../outbound/notion/verify.errors.js";

const CELL = {
  anchorHrefs: ["https://example.com/a"],
  anchorTexts: ["a"],
  column: 1,
  heightPx: 40,
  lineHeightPx: 20,
  row: 2,
  table: 1,
  text: "a cell",
};

const MERMAID = { codeBlockIndex: 3, index: 1, mode: "preview" };

const PROSE = { anchorHrefs: [], anchorTexts: [], index: 1, text: "A paragraph." };

describe("parseObservation", () => {
  it("parses a fully populated document back to exactly the input", () => {
    const document = { cells: [CELL], mermaid: [MERMAID], prose: [PROSE] };

    const result = parseObservation({ json: JSON.stringify(document), source: "/tmp/observation.json" });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(document);
  });

  it("parses an older document with no prose back to exactly the input, without adding a prose key", () => {
    const document = { cells: [CELL], mermaid: [MERMAID] };

    const result = parseObservation({ json: JSON.stringify(document), source: "/tmp/observation.json" });

    expect(result.isOk()).toBe(true);
    const observation = unwrap(result);
    expect(observation).toEqual(document);
    expect(Object.keys(observation)).toEqual(["cells", "mermaid"]);
  });

  it("refuses a key the form does not declare, as OBSERVATION_UNREADABLE", () => {
    const document = { cells: [], extra: true, mermaid: [], prose: [] };

    const error = unwrapErr(parseObservation({ json: JSON.stringify(document), source: "/tmp/observation.json" }));

    expect(error.code).toBe("OBSERVATION_UNREADABLE");
    expect(error.message).toContain("the observation in /tmp/observation.json does not describe a rendered page");
    expect(error.message).toContain("extra");
  });

  it("refuses malformed JSON as OBSERVATION_UNREADABLE, naming the source file", () => {
    const error = unwrapErr(parseObservation({ json: "{not json", source: "/tmp/observation.json" }));

    expect(error.code).toBe("OBSERVATION_UNREADABLE");
    expect(error).toEqual(
      NotionVerifyErrors.observationUnreadable({
        detail: "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
        path: "/tmp/observation.json",
      }),
    );
    expect(error.message).toBe(
      "the observation in /tmp/observation.json does not describe a rendered page: " +
        "Expected property name or '}' in JSON at position 1 (line 1 column 2). Re-run the measurement " +
        "step from `slopweaver notion verify <page>` in your own Chrome and pass what it returns.",
    );
  });
});
