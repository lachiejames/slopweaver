import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseRedactForm, parseTerminalShotForm } from "../../../visualEvidence/captureForms.js";
import { visualEvidenceErrorLines } from "../../../visualEvidence/evidenceErrors.js";

describe("parseTerminalShotForm", () => {
  it("reads a form with a line range, and one without", () => {
    expect(
      unwrap(
        parseTerminalShotForm({
          value: { label: "acme pane", lines: { from: 2, to: 3 }, out: "/tmp/a.png", textFile: "/tmp/a.txt" },
        }),
      ),
    ).toStrictEqual({ label: "acme pane", lines: { from: 2, to: 3 }, out: "/tmp/a.png", textFile: "/tmp/a.txt" });
    expect(
      unwrap(parseTerminalShotForm({ value: { label: "acme pane", out: "/tmp/a.png", textFile: "/tmp/a.txt" } })).lines,
    ).toBeUndefined();
  });

  it("refuses a relative path, a non-PNG out and an undeclared key, naming each field", () => {
    const error = unwrapErr(
      parseTerminalShotForm({ value: { extra: 1, label: "acme pane", out: "/tmp/a.jpg", textFile: "a.txt" } }),
    );
    expect(error.code).toBe("TERMINAL_TEXT_REFUSED");
    const lines = visualEvidenceErrorLines({ error }).join("\n");
    expect(lines).toContain("out: must end in .png");
    expect(lines).toContain("textFile: must be an absolute path");
    expect(lines).toContain("extra");
  });
});

describe("parseRedactForm", () => {
  const rect = { height: 4, width: 4, x: 0, y: 0 };

  it("reads a form with at least one rectangle", () => {
    expect(
      unwrap(parseRedactForm({ value: { out: "/tmp/b.png", rects: [rect], source: "/tmp/a.png" } })),
    ).toStrictEqual({ out: "/tmp/b.png", rects: [rect], source: "/tmp/a.png" });
  });

  it("refuses no rectangles, and an out that would overwrite the source", () => {
    expect(unwrapErr(parseRedactForm({ value: { out: "/tmp/b.png", rects: [], source: "/tmp/a.png" } })).code).toBe(
      "REDACTION_REFUSED",
    );
    const same = unwrapErr(parseRedactForm({ value: { out: "/tmp/a.png", rects: [rect], source: "/tmp/a.png" } }));
    expect(visualEvidenceErrorLines({ error: same })).toContain("out must be a new file, never the source");
  });
});
