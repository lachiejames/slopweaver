/* A row's name and detail as separate parts, and that they are exactly what the rendered line carries. */
import { describe, expect, it } from "vitest";

import { renderSessionWatchRow, sessionWatchRowParts } from "../../../../sessions/watchReport.js";
import { UNMAPPED_ROW } from "./harness.js";

describe("sessionWatchRowParts", () => {
  it("names an untitled unmapped row by its cwd with the unmapped flag, and gives its quiet detail", () => {
    expect(sessionWatchRowParts({ row: UNMAPPED_ROW })).toStrictEqual({
      detail: "quiet 47m after agent.hook.PreToolUse",
      name: "/repo/gone [unmapped: id 37CC9FE8 not in cmux inventory — check `cmux list --json` / `session list --json`]",
    });
  });

  it("falls back to the bare workspace id only when the row has no title, ref or cwd at all", () => {
    expect(sessionWatchRowParts({ row: { ...UNMAPPED_ROW, cwd: undefined } }).name).toBe(
      "37CC9FE8 [unmapped: id 37CC9FE8 not in cmux inventory — check `cmux list --json` / `session list --json`]",
    );
  });

  it("is exactly the name and detail the rendered line carries", () => {
    const { name, detail } = sessionWatchRowParts({ row: UNMAPPED_ROW });

    expect(renderSessionWatchRow({ row: UNMAPPED_ROW })).toBe(`silent\t${name}\t${detail}\t36 tool call(s)`);
  });
});
