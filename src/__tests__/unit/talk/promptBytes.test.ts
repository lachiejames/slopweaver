/**
 * The Talk prompts' size, held to what they were before the source-fidelity rule
 * replaced the narrow phrase bans: that change makes the surfaces quote their source, and must not do it by growing
 * the prompts every turn pays for. A typed conversation carries the backend prompt and the typed block together, so
 * those two are held as one sum. Measured by this file with each
 * budget set to 0: 34,549 voice bytes, 65,529 backend and 1,805 typed. Repro: set a budget to 0
 * and run this file; the failure prints the bytes then.
 */
import { describe, expect, it } from "vitest";

import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";
import { TALK_TYPED_INSTRUCTIONS } from "../../../talk/talkSurface.js";

/** The voice prompt's bytes before the change. */
const VOICE_BUDGET = 34_549;

/** The backend prompt's bytes before the change. */
const BACKEND_BUDGET = 65_529;

/** The backend and typed blocks' bytes before the change, together. */
const TYPED_BUDGET = 65_529 + 1805;

describe("the Talk prompts' bytes", () => {
  it("keeps the voice prompt within its size before the source-fidelity rule", () => {
    expect(Buffer.byteLength(TALK_VOICE_INSTRUCTIONS, "utf8")).toBeLessThanOrEqual(VOICE_BUDGET);
  });

  it("keeps the backend prompt within its size before the source-fidelity rule", () => {
    expect(Buffer.byteLength(TALK_BACKEND_INSTRUCTIONS, "utf8")).toBeLessThanOrEqual(BACKEND_BUDGET);
  });

  it("keeps a typed conversation's prompt, backend and typed block together, within its size before", () => {
    const typed =
      Buffer.byteLength(TALK_BACKEND_INSTRUCTIONS, "utf8") + Buffer.byteLength(TALK_TYPED_INSTRUCTIONS, "utf8");
    expect(typed).toBeLessThanOrEqual(TYPED_BUDGET);
  });
});
