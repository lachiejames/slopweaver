/**
 * The JumpCloud atlas's own refusals: each factory's code and exact text, and the lines each one prints.
 *
 * The unserialisable refusal is deliberately ONE line with its problems joined, as it always printed, while
 * the unpublishable one prints each incoherence on its own line — the helper must keep that difference.
 */
import { describe, expect, it } from "vitest";

import { JumpcloudAtlasErrors, jumpcloudAtlasErrorLines } from "../../../../atlas/jumpcloud/atlasErrors.js";

describe("JumpcloudAtlasErrors", () => {
  it("names the API-key secret to set, and carries no value", () => {
    const error = JumpcloudAtlasErrors.apiKeyAbsent({ secretName: "jumpcloud-api-key" });
    expect(error).toEqual({
      code: "API_KEY_ABSENT",
      message:
        "the JumpCloud atlas is not configured: jumpcloud-api-key is required. Set it with: slopweaver secrets set jumpcloud-api-key",
      secretName: "jumpcloud-api-key",
    });
  });

  it("counts every misfiled entity and names the first five", () => {
    const error = JumpcloudAtlasErrors.kindMisfiled({ kind: "systems", misfiled: ["a", "b", "c", "d", "e", "f", "g"] });
    expect(error.code).toBe("KIND_MISFILED");
    expect(jumpcloudAtlasErrorLines({ error })).toEqual([
      "the systems file this run assembled carries 7 entity/entities of another kind: a, b, c, d, e",
    ]);
  });

  it("names the kind and the channel an empty observation was folded onto", () => {
    const error = JumpcloudAtlasErrors.channelEmpty({ channel: "directory-api", kind: "policies" });
    expect(error.code).toBe("CHANNEL_EMPTY");
    expect(error.message).toBe(
      "a policies observation was folded onto the directory-api channel while carrying nothing for it — the sync built the entity for the wrong surface",
    );
  });

  it("names the journal path it could not write, and why", () => {
    const error = JumpcloudAtlasErrors.resumeUnwritable({ cause: new Error("ENOTDIR"), path: "/x/_resume.jsonl" });
    expect(error.code).toBe("RESUME_UNWRITABLE");
    expect(jumpcloudAtlasErrorLines({ error })).toEqual([
      "could not write the JumpCloud resume journal at /x/_resume.jsonl: ENOTDIR",
    ]);
  });

  it("says why the journal could not be removed", () => {
    const error = JumpcloudAtlasErrors.resumeUnremovable({ cause: "busy" });
    expect(error.code).toBe("RESUME_UNREMOVABLE");
    expect(error.message).toBe("could not remove the JumpCloud resume journal: busy");
  });

  it("prints an unserialisable generation as one line with its problems joined", () => {
    const error = JumpcloudAtlasErrors.unserialisable({ problems: ["first", "second"] });
    expect(error.code).toBe("GENERATION_UNSERIALISABLE");
    expect(jumpcloudAtlasErrorLines({ error })).toEqual([
      "refusing the whole generation: it cannot be serialised, so nothing can say what would be written — first; second",
    ]);
  });

  it("prints an unpublishable generation's incoherences one per line, then the not-published line", () => {
    const error = JumpcloudAtlasErrors.unpublishable({ problems: ["one", "two"] });
    expect(error.code).toBe("GENERATION_UNPUBLISHABLE");
    expect(jumpcloudAtlasErrorLines({ error })).toEqual([
      "one",
      "two",
      "nothing was written — this generation is not published",
    ]);
    expect(error.message).toBe("one; two; nothing was written — this generation is not published");
  });
});
