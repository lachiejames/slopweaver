/**
 * What `talk find-card` accepts: the owner's words positionally, every one of them, and a refusal when there are none —
 * never a search over an empty topic.
 */
import { describe, expect, it } from "vitest";

import { parseFindCardArgs, TALK_FIND_CARD_FLAG_NAMES } from "../../../cli/commands/talk/findCardArgs.js";
import { TALK_FIND_CARD_USAGE } from "../../../cli/commands/talk/knowUsage.js";
import {
  TalkPositionalArgsErrors,
  talkPositionalArgsErrorLines,
} from "../../../cli/commands/talk/positionalArgsErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("parseFindCardArgs", () => {
  it("takes every word the owner and the paraphrases gave, with the flags", () => {
    expect(
      unwrap(parseFindCardArgs({ rest: ["voice", "other agents", "browser", "--json", "--home", "/tmp/a-home"] })),
    ).toEqual({ home: "/tmp/a-home", json: true, words: ["voice", "other agents", "browser"] });
  });

  it("refuses a call with no words, and one with only blank ones", () => {
    expect(talkPositionalArgsErrorLines({ error: unwrapErr(parseFindCardArgs({ rest: ["--json"] })) })).toEqual([
      "talk find-card needs the words the card would be about",
    ]);
    expect(unwrapErr(parseFindCardArgs({ rest: ["  ", ""] })).code).toBe("WORDS_MISSING");
  });

  it("carries each flag problem as its own line, so the verb prints one per line as before", () => {
    const refusal = unwrapErr(parseFindCardArgs({ rest: ["voice", "--nope", "--also"] }));
    expect(refusal).toEqual(
      TalkPositionalArgsErrors.flagsUnparsed({ problems: ["unknown flag: --nope", "unknown flag: --also"] }),
    );
    expect(talkPositionalArgsErrorLines({ error: refusal })).toEqual(["unknown flag: --nope", "unknown flag: --also"]);
  });

  it("names its flags as the usage line does", () => {
    expect(TALK_FIND_CARD_FLAG_NAMES).toEqual(["--home", "--json"]);
    expect(TALK_FIND_CARD_USAGE).toBe("usage: slopweaver talk find-card <words>... [--home <dir>] [--json]");
  });
});
