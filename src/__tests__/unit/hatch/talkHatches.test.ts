import { describe, expect, it } from "vitest";
import { ESCAPE_HATCHES } from "../../../hatch/registry.js";
import { TALK_HATCHES } from "../../../hatch/talkHatches.js";

/*
 * The same two properties `codexPassHatches.test.ts` guards, for the `talk` verbs' rows cut out of the register:
 * a row dropping out of the one array the `escape-hatch` gate reads, and the register's reading order silently
 * changing. Row CONTENTS stay `registry.test.ts`'s subject for the whole set.
 */
describe("TALK_HATCHES", () => {
  it("declares the talk verbs' rows and the call-state tripwire's, in their register order", () => {
    expect(TALK_HATCHES.length).toBeGreaterThan(0);
    expect(TALK_HATCHES.map((hatch) => hatch.id)).toEqual([
      "talk-file-credential",
      "unread-mark-adopt",
      "non-owner-console-live-talk",
      "call-state-delete",
    ]);
  });

  it("is spread into the one register, after `unescalated-fleet-health`, contiguously and in order", () => {
    const ids = ESCAPE_HATCHES.map((hatch) => hatch.id);
    const at = ids.indexOf("talk-file-credential");
    expect(ids[at - 1]).toBe("unescalated-fleet-health");
    expect(ids.slice(at, at + TALK_HATCHES.length)).toEqual(TALK_HATCHES.map((h) => h.id));
  });

  it("lifts the credential PATH refusal by env, never a command incantation", () => {
    expect(TALK_HATCHES[0].key).toEqual({ kind: "env", variable: "SLOPWEAVER_ALLOW_TALK_FILE_CREDENTIAL" });
    expect(TALK_HATCHES[0].reader).toBe("src/cli/commands/talk/fileRun.ts");
  });
});
