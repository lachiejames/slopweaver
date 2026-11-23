import { describe, expect, it } from "vitest";

import { JamAtlasErrors, jamAtlasErrorLines } from "../../../../atlas/jam/errors.js";
import { notFoundControlsAgree } from "../../../../atlas/jam/notFoundControl.js";
import { verbFailureWhy } from "../../../../live/automation/verbFailureWhy.js";

describe("JamAtlasErrors", () => {
  it("names the table defect as the one line of an invalid registry", () => {
    const error = JamAtlasErrors.registryInvalid({ detail: "operation x has no scope" });
    expect(error).toEqual({
      code: "REGISTRY_INVALID",
      detail: "operation x has no scope",
      message: "the committed Jam surface table cannot be published: operation x has no scope",
    });
    expect(jamAtlasErrorLines({ error })).toEqual([
      "the committed Jam surface table cannot be published: operation x has no scope",
    ]);
  });

  it("prints an unwritable store's reasons one per line, and joins them into its message", () => {
    const error = JamAtlasErrors.storeUnwritable({ reasons: ["EACCES on manifest.json", "disk full"] });
    expect(error.code).toBe("STORE_UNWRITABLE");
    expect(error.message).toBe("the Jam atlas generation could not be written: EACCES on manifest.json; disk full");
    expect(jamAtlasErrorLines({ error })).toEqual(["EACCES on manifest.json", "disk full"]);
  });

  it("prints an unreadable store's reasons one per line", () => {
    const error = JamAtlasErrors.storeUnreadable({ reasons: ["manifest.json is schema version 9"] });
    expect(error.code).toBe("STORE_UNREADABLE");
    expect(error.message).toBe("the Jam atlas generation on disk could not be read: ");
    expect(jamAtlasErrorLines({ error })).toEqual(["manifest.json is schema version 9"]);
  });

  it("quotes the probe's transport reason as the one line of an unreachable application", () => {
    const error = JamAtlasErrors.rootUnreachable({ detail: "the relay stopped answering" });
    expect(error).toEqual({
      code: "ROOT_UNREACHABLE",
      detail: "the relay stopped answering",
      message: "could not reach the Jam application to learn its team root: the relay stopped answering",
    });
    expect(jamAtlasErrorLines({ error })).toEqual([
      "could not reach the Jam application to learn its team root: the relay stopped answering",
    ]);
  });

  it("prints the sign-in page as two lines", () => {
    const error = JamAtlasErrors.signedOut();
    expect(error.code).toBe("SIGNED_OUT");
    expect(jamAtlasErrorLines({ error })).toEqual([
      "the Jam application answered its own root with its sign-in page, so no page could be walked",
      "sign in to Jam in your own Chrome and run the walk again",
    ]);
  });

  describe("uncorroborated", () => {
    /** The first line, which is the same whatever the cause. */
    const UNUSABLE =
      "the walk's not-found controls were unusable, so this run cannot tell a real page from one Jam rendered for a route it does not have — and nine such pages were published as reached before any control existed (`notFoundControl.ts`).";

    it("keeps the typed cause and its sentence on the error, so a caller can branch on which way it failed", () => {
      const error = JamAtlasErrors.uncorroborated({ because: "the visit failed", cause: "control-unreachable" });
      expect(error.code).toBe("CONTROL_UNCORROBORATED");
      expect(error.cause).toBe("control-unreachable");
      expect(error.because).toBe("the visit failed");
    });

    /** The explanation line every cause but `band` carries before the closing line. */
    const WALK_AGAIN =
      "this run failed to observe a control, which says nothing about Jam's not-found page: run the walk again rather than re-measuring the band";

    // The scheduled recipe keeps a refusal's closing stderr line, so remedy and cause ride the LAST one.
    it("prescribes re-measuring the band only when the band disagreed, the short remedy leading the last line", () => {
      const error = JamAtlasErrors.uncorroborated({ because: "the two controls do not corroborate", cause: "band" });
      expect(jamAtlasErrorLines({ error })).toEqual([
        UNUSABLE,
        "the two controls were photographed and disagreed, so Jam may have changed its not-found page: re-measure the band in `notFoundControl.ts` against a fresh walk before trusting a page grading again",
        "nothing was published — remedy: re-measure the band in `notFoundControl.ts`; cause: the two controls do not corroborate",
      ]);
    });

    it("tells a walk that visited no control to run again, not to re-measure the band", () => {
      const error = JamAtlasErrors.uncorroborated({
        because: "the walk visited no page under the control surface `not-found-invented`",
        cause: "control-missing",
      });
      expect(jamAtlasErrorLines({ error })).toEqual([
        UNUSABLE,
        WALK_AGAIN,
        "nothing was published — remedy: run the walk again; cause: the walk visited no page under the control surface `not-found-invented`",
      ]);
    });

    it("tells a walk whose control was unreached to run again", () => {
      const error = JamAtlasErrors.uncorroborated({
        because: "the control `not-found-control` was not reached at all: the relay stopped answering",
        cause: "control-unreachable",
      });
      expect(jamAtlasErrorLines({ error })).toEqual([
        UNUSABLE,
        WALK_AGAIN,
        "nothing was published — remedy: run the walk again; cause: the control `not-found-control` was not reached at all: the relay stopped answering",
      ]);
    });

    it("tells a walk whose control carries no screenshot to run again", () => {
      const error = JamAtlasErrors.uncorroborated({
        because: "the control `not-found-invented` was reached and carries no screenshot",
        cause: "control-unphotographed",
      });
      expect(jamAtlasErrorLines({ error })).toEqual([
        UNUSABLE,
        WALK_AGAIN,
        "nothing was published — remedy: run the walk again; cause: the control `not-found-invented` was reached and carries no screenshot",
      ]);
    });

    it("collapses every line break in the cause to one space, so the closing line stays one physical line", () => {
      const error = JamAtlasErrors.uncorroborated({
        because: "the control `not-found-control` was not reached at all: the relay\r\n\r\n  stopped\nanswering",
        cause: "control-unreachable",
      });
      expect(error.because).toBe("the control `not-found-control` was not reached at all: the relay stopped answering");
      expect(jamAtlasErrorLines({ error }).at(-1)).toBe(
        "nothing was published — remedy: run the walk again; cause: the control `not-found-control` was not reached at all: the relay stopped answering",
      );
    });

    // The composition the scheduled recipe really performs: the verb's stderr is the refusal's lines followed by
    // the wrapper's own two exit lines, and `verbFailureWhy` keeps the last three, each cut at 240 characters —
    // so only the refusal's closing line survives, and only its head. A past finding was exactly this shape.
    it("keeps the whole band remedy and the cause's opening words through the recipe's failure reducer", () => {
      const because = notFoundControlsAgree({ anchorBytes: 100_000, declaredBytes: 200_000 })!;
      const error = JamAtlasErrors.uncorroborated({ because, cause: "band" });
      const stderr = [...jamAtlasErrorLines({ error }), "`slopweaver atlas jam refresh` exited 1", "exited 1"].join(
        "\n",
      );

      const kept = verbFailureWhy({ text: stderr })!;

      expect(jamAtlasErrorLines({ error }).at(-1)!.length).toBeGreaterThan(240);
      expect(kept).toContain(
        "nothing was published — remedy: re-measure the band in `notFoundControl.ts`; cause: the two controls do not corroborate each other: the invented route rendered 100000 bytes",
      );
      expect(kept).toContain(" / `slopweaver atlas jam refresh` exited 1 / exited 1");
    });
  });

  it("points a rootless walk at the session rather than the band", () => {
    const error = JamAtlasErrors.rootMissing();
    expect(error.code).toBe("ROOT_MISSING");
    expect(jamAtlasErrorLines({ error })[1]).toBe(
      "nothing was published. Open jam.dev in your own Chrome, check it settles under /s/, and run the walk again",
    );
  });
});
