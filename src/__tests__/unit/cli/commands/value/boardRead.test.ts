/**
 * `readBoardAskRows` over a throwaway home: a home with no handovers yields no rows, and one written handover doc comes
 * back as its ask fields.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { readBoardAskRows } from "../../../../../cli/commands/value/boardRead.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "value-board-"));
  homes.push(home);
  return home;
};

describe("readBoardAskRows", () => {
  it("answers no rows for a home whose board is empty", () => {
    const home = freshHome();
    mkdirSync(join(home, "handovers"), { recursive: true });

    expect(unwrap(readBoardAskRows({ home }))).toEqual([]);
  });

  it("reads one handover doc back as its slug, kind and summary", () => {
    const home = freshHome();
    mkdirSync(join(home, "handovers"), { recursive: true });
    writeFileSync(
      join(home, "handovers", "acme-doc.md"),
      "---\nslug: acme-doc\nstatus: ready\nsummary: Export the widget report\n---\n\n# Export the widget report\n",
    );

    const rows = unwrap(readBoardAskRows({ home }));

    expect(rows.map((row) => [row.slug, row.kind, row.summary])).toEqual([
      ["acme-doc", "doc", "Export the widget report"],
    ]);
  });
});
