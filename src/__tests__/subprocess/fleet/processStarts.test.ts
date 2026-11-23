/**
 * The real `/bin/ps` listing both `fleet health` and `fleet resume` bind a process with: it must carry this very
 * process, stamped in the one form `parseProcessStarts` reads.
 */
import { describe, expect, it } from "vitest";

import { readProcessStarts } from "../../../fleet/processStarts.js";

/** A day, month, space-padded date, time and year, as `ps -o lstart=` prints in the C locale. */
const LSTART = /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/;

describe("readProcessStarts", () => {
  it("lists this process with its start stamp", () => {
    const listing = readProcessStarts();
    expect(Object.keys(listing)).toEqual(["starts"]);
    const { starts } = listing as { readonly starts: ReadonlyMap<number, string> };
    expect(starts.get(process.pid)).toMatch(LSTART);
  });
});
