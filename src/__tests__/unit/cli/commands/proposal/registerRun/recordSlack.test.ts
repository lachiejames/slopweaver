/*
 * `proposal record-slack`: a slack-linked event appended to the entry's permalinks, and `--permalink` required.
 */
import { describe, expect, it } from "vitest";

import { runProposalRecordSlack } from "../../../../../../cli/commands/proposal/registerRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { loadRegisterEntry } from "../../../../../../outbound/proposal/register/store.js";
import { argv, harness, seedRegistered, tempHome, useRegisterHomes } from "./harness.js";

useRegisterHomes();

describe("runProposalRecordSlack", () => {
  it("appends a slack-linked event", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    const code = runProposalRecordSlack({
      argv: argv({
        rest: ["a-slug", "--permalink", "https://example.slack.com/archives/C1/p1", "--home", home],
        verb: "record-slack",
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(unwrap(loadRegisterEntry({ home, slug: "a-slug" }))!.slackPermalinks).toEqual([
      "https://example.slack.com/archives/C1/p1",
    ]);
  });

  it("refuses without --permalink", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    expect(
      runProposalRecordSlack({ argv: argv({ rest: ["a-slug", "--home", home], verb: "record-slack" }), deps: h.deps }),
    ).toBe(EXIT_USAGE);
  });
});
