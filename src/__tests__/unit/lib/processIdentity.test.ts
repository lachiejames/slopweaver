/**
 * Only a start stamp that names a real instant is reported, so a garbled `ps` column reads as "no stamp" — which
 * leaves a running pid alone — and never as a different process, which would reap a live holder.
 */
import { describe, expect, it } from "vitest";

import { usableStamp } from "../../../lib/processIdentity.js";

describe("usableStamp", () => {
  it("passes a real lstart stamp through unchanged, its padding intact", () => {
    expect(usableStamp({ text: "Fri Oct  9 11:36:11 2026" })).toBe("Fri Oct  9 11:36:11 2026");
  });

  it("reports no stamp for text that names no instant", () => {
    expect(usableStamp({ text: "garbage" })).toBe(undefined);
    expect(usableStamp({ text: "Mon Feb 31 11:36:11 2026" })).toBe(undefined);
  });
});
