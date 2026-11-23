/*
 * Every read the page's relay gate records that is not a tool call is one `talk relay` accepts, and the exit the
 * page retries on is the one the verb refuses with before it writes anything.
 *
 * `site/` cannot import `src/` at build time, so the names are spelled twice; this test is what makes the copy
 * safe. It reads the verb's side from `src/talk/relayReadSources.ts` and `src/cli/exitCodes.ts`, which import
 * nothing. The page named `context_pack` and the verb did not, and every relay made while a context pack rode
 * in was refused.
 */
import { describe, expect, it } from "vitest";

import { EXIT_USAGE } from "../../../src/cli/exitCodes";
import { RELAY_STANDING_READS, RELAY_TRANSIENT_READS } from "../../../src/talk/relayReadSources";
import {
  CODE_MODE_READ,
  COLLABORATION_READ,
  CONTEXT_PACK_READ,
  OPEN_CARD_DRAFT_READ,
  standingReads,
  WEB_SEARCH_READ,
} from "../../lib/relayGate";
import { VERB_USAGE_EXIT } from "../../lib/relayRetry";

describe("the relay's read sources", () => {
  it("are the verb's standing reads, exactly", () => {
    expect(RELAY_STANDING_READS.length).toBeGreaterThan(0);
    expect([CONTEXT_PACK_READ, WEB_SEARCH_READ, CODE_MODE_READ, COLLABORATION_READ]).toEqual([...RELAY_STANDING_READS]);
  });

  it("are the verb's one-turn reads, exactly", () => {
    expect([OPEN_CARD_DRAFT_READ]).toEqual([...RELAY_TRANSIENT_READS]);
  });
});

describe("standingReads", () => {
  it("counts the delegate's search, code-mode exec and sub-agents, and the context pack only when one rode in", () => {
    expect(standingReads({ packed: true })).toEqual(["context_pack", "web_search", "code_mode", "collaboration"]);
    expect(standingReads({ packed: false })).toEqual(["web_search", "code_mode", "collaboration"]);
  });
});

describe("the retry's exit", () => {
  it("is the verb's usage exit, the one it refuses with before claiming a turn", () => {
    expect(VERB_USAGE_EXIT).toBe(EXIT_USAGE);
  });
});
