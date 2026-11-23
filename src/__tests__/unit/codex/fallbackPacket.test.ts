/**
 * A fallback packet is scratch written outside the home: its own `mkdtemp` directory under the OS temp root,
 * owner-only, never a predictable path, and removable when its request never reached the store.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";

import { describe, expect, it } from "vitest";

import { discardPacket, writePlanPacket, writeReviewPacket } from "../../../codex/fallbackPacket.js";
import { unwrap } from "../../../lib/result.js";

describe("the fallback packet", () => {
  it("writes a review packet wrapping the diff, owner-only, in a fresh directory under the temp root", () => {
    const packet = unwrap(
      writeReviewPacket({ diff: "+added\n", property: { id: "r1-01", statement: "it holds" }, requestId: "req-a" }),
    );
    expect(dirname(packet.scratchDir)).toBe(tmpdir());
    expect(packet.scratchDir).toContain("slopweaver-fallback-req-a-");
    expect(readFileSync(packet.packetPath, "utf8")).toContain("<<<UNTRUSTED_DIFF\n+added\n\n>>>END_UNTRUSTED_DIFF");
    expect(statSync(packet.scratchDir).mode & 0o777).toBe(0o700);
    discardPacket({ packet });
  });

  it("writes a plan packet as the exact prompt, 0600, and two requests never share a directory", () => {
    const first = unwrap(writePlanPacket({ prompt: "THE TASK:\nplan it", requestId: "plan-a" }));
    const second = unwrap(writePlanPacket({ prompt: "other", requestId: "plan-a" }));
    expect(readFileSync(first.packetPath, "utf8")).toBe("THE TASK:\nplan it");
    expect(statSync(first.packetPath).mode & 0o777).toBe(0o600);
    expect(second.scratchDir).not.toBe(first.scratchDir);
    discardPacket({ packet: first });
    discardPacket({ packet: second });
  });

  it("discarding a packet removes its whole directory", () => {
    const packet = unwrap(writePlanPacket({ prompt: "p", requestId: "plan-b" }));
    discardPacket({ packet });
    expect(existsSync(packet.scratchDir)).toBe(false);
  });
});
