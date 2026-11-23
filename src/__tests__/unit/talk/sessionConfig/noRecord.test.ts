/**
 * What both halves say about an earlier call, a line the voice said on this one, and a line still on its way to
 * the record: there is no record of the first, the second is always said back, and the third has not arrived yet.
 */
import { describe, expect, it } from "vitest";

import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../../talk/sessionConfig.js";

describe("TALK_TOOLS", () => {
  // Asked "where were we" after a restart, the voice once named a mobile app the owner
  // never mentioned.
  it("tells both halves to say there is no record of an earlier call rather than invent one", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("Never invent a topic no block or tool names: with");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "names what the OWNER said before, say you have no record of it: never fill the gap with a topic of your own.",
    );
  });

  // Asked what "eighty-six" was, the voice once said it had
  // no record of saying it. "No record" is for the owner's earlier words only; its own lines on the call are always said back.
  it("never lets either half answer 'no record' about a line the voice said on this call", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain("That is\nfor the owner's earlier words only.");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("Never say you have no record of something you said on this call.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Never answer 'I have no record of that' about a line on this call, and never invent a source.",
    );
  });

  // A turn that completes before the voice's cut-off line is FINAL never holds it (`spokenRecordQueue.ts`),
  // so the thread says it has not reached it yet rather than guessing the line or denying it.
  it("gives the thread an honest answer for a line still on its way to the record", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "  the record does not hold yet, say it has not reached you yet and ask which words the owner means; never guess\n  the line, and never say it was not said.",
    );
  });
});
