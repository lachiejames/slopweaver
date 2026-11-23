/*
 * A hand-step card's right-hand tags name the system the step touches as `integration=<name>`, read from
 * `hand list --json` through the real reader, and the workstream its rows put it in; a generic "your
 * hands" label tells the owner nothing.
 */
import { describe, expect, it } from "vitest";

import { readHandSteps } from "../../components/live/read";
import { handPill } from "../../lib/handPill";

/** One register line as `hand list --json` prints it. */
const LINE = {
  id: "store-secops-client",
  postedIso: "2026-10-02T06:55:34.641Z",
  what: "Store the SecOps OAuth client id",
};

/** The first step the real reader keeps from one line. */
function stepOf({ line }: { line: Record<string, unknown> }) {
  return readHandSteps([line])![0];
}

describe("handPill", () => {
  it("draws the integration the register named", () => {
    expect(handPill({ step: stepOf({ line: { ...LINE, integration: "Google SecOps" } }), workstreams: [] })).toBe(
      "integration=Google SecOps",
    );
  });

  it("says none when the step names no integration, never a word for who acts", () => {
    expect(handPill({ step: stepOf({ line: LINE }), workstreams: [] })).toBe("integration=none");
  });

  it("adds the workstream its rows put it in, several sorted and comma-joined", () => {
    const step = stepOf({ line: { ...LINE, integration: "Google SecOps" } });
    expect(handPill({ step, workstreams: ["iso-certification"] })).toBe(
      "integration=Google SecOps · workstream=iso-certification",
    );
    expect(handPill({ step, workstreams: ["vuln-work", "iso-certification"] })).toBe(
      "integration=Google SecOps · workstream=iso-certification,vuln-work",
    );
  });

  it("draws a line whose integration is not text as unreadable, naming integration", () => {
    expect(readHandSteps([{ ...LINE, integration: 7 }])![0].unreadable).toBe("integration");
  });
});
