/**
 * `slopweaver slack draft record --approved` holds the call still at the park.
 *
 * The owner's yes is resolved before the recording's Slack reads, so the words it names could be cut, revised or
 * re-placed by the time the row parks. The park therefore takes the call's fence under the register lock and resolves
 * the yes again there, parking nothing when that read differs from the first.
 */
import { describe, expect, it } from "vitest";

import { runSlackDraftWithDeps } from "../../../../../../cli/commands/slack/draftRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { RawWords } from "../../../../../../handover/hisWordsResolve.js";
import { ok } from "../../../../../../lib/result.js";
import { RECORD_TAIL, shown } from "./forms.js";
import { argv, draftDeps, freshRecording } from "./world.js";

const ANCHOR = "talk-call:541f50a8-0000-4000-8000-000000000001#turn_SendIt";
const HEARD: RawWords = {
  atIso: "2026-10-07T05:52:59.000Z",
  context: { kind: "call-segment", open: undefined },
  headKnown: true,
  headLost: false,
  tailKnown: true,
  tailLost: false,
  text: "That is an excellent draft. Send it",
  where: "call",
};
const FORM = JSON.stringify(shown({ lines: ["Four groups, one question.", "Which is the right state?"] }));

/**
 * Record with `--approved`, the words read first as {@link HEARD} and under the park's fence as `later`, the fence's
 * recheck answering `announced`.
 */
const parkWith = async ({
  announced,
  later,
}: {
  announced?: string;
  later: RawWords;
}): Promise<readonly [number, readonly string[], number]> => {
  const seen = freshRecording();
  const world = draftDeps({ hisWords: ok(HEARD), recording: seen, stdin: FORM });
  let reads = 0;
  const code = await runSlackDraftWithDeps({
    argv: argv({ tail: [...RECORD_TAIL, "--approved", ANCHOR] }),
    deps: {
      ...world,
      fenceCallWrites: ({ anchor }) => {
        seen.calls.push(`fence:${anchor}`);
        return ok({
          recheck: () => {
            seen.calls.push("recheck");
            return announced;
          },
          release: () => {
            seen.calls.push("release");
          },
        });
      },
      readOwnerWords: (request) => {
        reads += 1;
        return reads === 1 ? world.readOwnerWords(request) : ok(later);
      },
    },
  });
  const fenced = seen.calls.filter((call) => call.startsWith("fence") || call === "recheck" || call === "release");
  return [code, fenced, seen.appended.filter((event) => event.kind === "parked").length];
};

describe("slack draft record --approved — the park fences the call and reads the yes again", () => {
  it("parks only while the fenced read says exactly what the first did, releasing the fence either way", async () => {
    expect([
      await parkWith({ later: HEARD }),
      await parkWith({ later: { ...HEARD, tailLost: true } }),
      await parkWith({ later: { ...HEARD, text: "Send it, but not yet" } }),
    ]).toEqual([
      [EXIT_OK, [`fence:${ANCHOR}`, "recheck", "release"], 1],
      [EXIT_USAGE, [`fence:${ANCHOR}`, "release"], 0],
      [EXIT_USAGE, [`fence:${ANCHOR}`, "release"], 0],
    ]);
  });

  it("parks nothing when a batch was announced while the fenced read ran, releasing the fence", async () => {
    expect(await parkWith({ announced: "1 transcript or landing write(s) were announced", later: HEARD })).toEqual([
      EXIT_USAGE,
      [`fence:${ANCHOR}`, "recheck", "release"],
      0,
    ]);
  });
});
