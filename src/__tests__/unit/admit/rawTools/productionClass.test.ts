/*
 * `classifyRawCommand` on the production-facing class: neither the process-wide nor the inline escape opens it, only
 * a live reach grant naming that exact tool does, and a second production tool in the same command is still refused.
 */
import { describe, expect, it } from "vitest";

import { classifyRawCommand } from "../../../../admit/rawTools.js";
import { blockedMessage } from "./harness.js";

describe("the production-facing class does NOT take the ambient escape (option C)", () => {
  it("refuses twilio even with the process-wide break-glass set", () => {
    // The whole point of C: an exported variable is ambient and traceless, which is the wrong shape when a
    // mistake is visible to a real person. If this ever passes, C has been silently undone.
    const verdict = classifyRawCommand({ allowRaw: true, command: "twilio api:core:messages:create --to +100" });
    expect(verdict.blocked).toBe(true);
  });

  it("refuses twilio even with an inline per-segment override", () => {
    const verdict = classifyRawCommand({
      allowRaw: false,
      command: "SLOPWEAVER_ALLOW_RAW=1 twilio api:core:messages:create --to +100",
    });
    expect(verdict.blocked).toBe(true);
  });

  it("names the grant verb rather than the env var", () => {
    const message = blockedMessage({ command: "stripe charges create --amount 100" });
    expect(message).toContain("slopweaver session reach-grant --tool stripe");
    expect(message).toContain("DOES NOT TAKE SLOPWEAVER_ALLOW_RAW");
  });

  it("admits the call when a live grant names that exact tool", () => {
    const verdict = classifyRawCommand({
      allowRaw: false,
      command: "twilio api:core:messages:create --to +100",
      reachGranted: ({ tool }) => ({ granted: tool === "twilio", grantsTaken: 1 }),
    });
    expect(verdict.blocked).toBe(false);
  });

  it("still refuses a DIFFERENT production tool in the same command", () => {
    // A grant is one tool. A compound command must not ride one grant into a second system.
    const verdict = classifyRawCommand({
      allowRaw: false,
      command: "twilio api:core:messages:create --to +100 && stripe charges create --amount 100",
      reachGranted: ({ tool }) => ({ granted: tool === "twilio", grantsTaken: 1 }),
    });
    expect(verdict.blocked).toBe(true);
    expect(verdict.blocked ? verdict.tool : "").toBe("stripe");
  });

  it("refuses when no grant reader is injected at all", () => {
    // The pure default finds no grants, so the class refuses — the safe direction for a caller with no
    // session to check against.
    expect(classifyRawCommand({ allowRaw: true, command: "vercel deploy --prod" }).blocked).toBe(true);
  });
});
