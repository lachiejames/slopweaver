/**
 * Unit: binding a calendar write's seams refuses a home that holds no calendar grant, before any API is built.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boundCalendarWriter } from "../../../../../cli/commands/calendar/writeBinding.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-calendar-binding-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("boundCalendarWriter", () => {
  it("refuses a home with no stored calendar grant as NOT_CONNECTED", async () => {
    const bound = await boundCalendarWriter({ home });
    expect(bound.isErr()).toBe(true);
    expect(bound._unsafeUnwrapErr().code).toBe("NOT_CONNECTED");
  });
});
