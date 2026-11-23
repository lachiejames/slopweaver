/**
 * Unit: the silence before a call step's words. MEASURED on a real call: about 23 s passed between the
 * call file opening and the leg going live, past the shared 15 s lead, so `draft-read-back`'s opening was never heard.
 */
import { describe, expect, it } from "vitest";

import { LEAD_SILENCE_MS } from "../../../cli/commands/desktop/e2eCallAudio.js";
import { microphoneLeadMs } from "../../../desktop/e2eCallPlan.js";

describe("microphoneLeadMs", () => {
  it("gives draft-read-back its own 45 s lead and every other step the shared one", () => {
    expect([
      LEAD_SILENCE_MS,
      microphoneLeadMs({ id: "draft-read-back", standard: LEAD_SILENCE_MS }),
      microphoneLeadMs({ id: "long-task-mid-call", standard: LEAD_SILENCE_MS }),
      microphoneLeadMs({ id: "call-live", standard: LEAD_SILENCE_MS }),
    ]).toEqual([15_000, 45_000, 15_000, 15_000]);
  });
});
