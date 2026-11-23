/**
 * `TurnErrors` — the typed failures `src/live/turn` authors, and the lines each one prints.
 */
import { describe, expect, it } from "vitest";

import { DoorStoreErrors } from "../../../../admit/doorStoreErrors.js";
import type { DoorDecision } from "../../../../admit/types.js";
import { JUDGEMENT_NOTE } from "../../../../hatch/render.js";
import { TurnErrors, turnErrorLines } from "../../../../live/turn/turnErrors.js";

describe("TurnErrors", () => {
  it("keeps every out-of-order upload on its own line", () => {
    const error = TurnErrors.uploadsOutOfOrder({
      mismatches: [
        { filename: "b.png", index: 0, path: "/s/a.png" },
        { filename: "a.png", index: 1, path: "/s/b.png" },
      ],
    });

    expect(error.code).toBe("UPLOAD_BINDING_REFUSED");
    expect(turnErrorLines({ error })).toEqual([
      `attachment 1 is named "b.png" but its path is "/s/a.png" — the uploads are not in the answer's own image order`,
      `attachment 2 is named "a.png" but its path is "/s/b.png" — the uploads are not in the answer's own image order`,
    ]);
  });

  it("gathers each unrecorded image failure as one line, joined by `; ` in the message", () => {
    const error = TurnErrors.imageObservationsUnrecorded({
      failures: [
        TurnErrors.imageRecordFailed({ cause: "EACCES", filename: "a.png", stage: "read" }),
        TurnErrors.imageRecordFailed({ cause: "ENOSPC", filename: "b.png", stage: "append" }),
      ],
    });

    expect(turnErrorLines({ error })).toEqual([
      "could not read the image records for a.png: EACCES",
      "could not record what the reviewer saw in b.png: ENOSPC",
    ]);
    expect(error.message).toBe(
      "could not read the image records for a.png: EACCES; could not record what the reviewer saw in b.png: ENOSPC",
    );
  });

  it("names the unresolved mentions in one refusal line", () => {
    const error = TurnErrors.mentionsUnresolved({ missing: ["ana", "bo"] });

    expect(error).toEqual({
      code: "MENTIONS_REFUSED",
      message: "the answer mentions ana, bo, which do not resolve in the identity map",
      reasons: ["the answer mentions ana, bo, which do not resolve in the identity map"],
    });
    expect(turnErrorLines({ error })).toEqual([
      "the answer mentions ana, bo, which do not resolve in the identity map",
    ]);
  });

  it("prints a single-message variant as its one line", () => {
    const error = TurnErrors.completionInvalid({ invariant: "no-working-ts" });

    expect(error).toEqual({
      code: "COMPLETION_INVALID",
      invariant: "no-working-ts",
      message: "a completion requires workingTs — the working message always exists before a turn settles",
    });
    expect(turnErrorLines({ error })).toEqual([
      "a completion requires workingTs — the working message always exists before a turn settles",
    ]);
  });

  it("says which way a reaction change was declined", () => {
    expect(TurnErrors.reactionDeclined({ action: "remove", emoji: "eyes" }).message).toBe(
      "slack declined to remove the stale :eyes: reaction",
    );
    expect(TurnErrors.reactionDeclined({ action: "add", emoji: "white_check_mark" }).message).toBe(
      "slack declined to add the :white_check_mark: reaction",
    );
  });

  it("names a door's refusal to title the thread by its finding and way through, never the bare verdict", () => {
    const decision: DoorDecision = {
      findings: [{ code: "demo.hold", correction: "load the profile", severity: "hold", summary: "no profile" }],
      overridden: [],
      status: "hold",
    };
    const error = TurnErrors.threadNameRefused({ through: { decision, kind: "door-refused", performed: false } });

    expect(error.code).toBe("THREAD_NAME_REFUSED");
    expect(error.message).toBe(
      [
        "the door did not admit this (hold). Nothing was changed.",
        "naming this thread blocked because no profile [demo.hold].",
        "There is no escape hatch for this one: a hold is the irreversible-harm arm of the door and no per-action token waives it.",
        "The way through is to satisfy it: load the profile",
        JUDGEMENT_NOTE,
      ].join("\n"),
    );
  });

  it("names a thread title the door passed but the store could not record as a recording fault, not a refusal", () => {
    const decision: DoorDecision = { findings: [], overridden: [], status: "pass" };
    const storeError = DoorStoreErrors.eventUnstorable({ reason: "a bad field", runId: "run-1" });
    const error = TurnErrors.threadNameRefused({
      through: { decision, error: storeError, kind: "recording-refused", performed: false },
    });

    expect(error.message).toBe(`naming this thread not performed: ${storeError.message}`);
  });
});
