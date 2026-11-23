/**
 * The settled-chase hold's one effectful step, called directly with a plain fake pull-request read: a chase on a
 * closed pull request refuses closing on the nothing-parked line, an open one passes, and a row of any other act
 * reads nothing. The rule's every state is `../../../outbound/slack/settledChase.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { NOTHING_PARKED } from "../../../../../cli/commands/slack/draftMedia.js";
import { settledChaseHold } from "../../../../../cli/commands/slack/draftSettledChase.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { PullRequestLiveState } from "../../../../../live/github/pullRequestState.js";
import { ChaseSubjectErrors } from "../../../../../outbound/slack/settledChaseErrors.js";

const PAYLOAD = {
  form: "plain",
  text: "bumping this one: <https://github.com/acme/acme-admin/pull/18404|#18404>",
  unfurl_links: false,
  unfurl_media: false,
};

/** A read the case under test must never reach. */
function unreachable(): never {
  throw new Error("the hold read a pull request its act does not chase");
}

/**
 * A fake read answering one state, which records each pull request it was asked about.
 *
 * @param state what GitHub answers for every pull request
 * @returns the read and the list of what it was asked
 */
function readAnswering({ state }: { state: PullRequestLiveState }): {
  asked: string[];
  read: (args: { home: string; repo: string; number: number }) => Promise<PullRequestLiveState>;
} {
  const asked: string[] = [];
  return {
    asked,
    read: async ({ number, repo }) => {
      asked.push(`${repo}#${number}`);
      return state;
    },
  };
}

describe("settledChaseHold — the live read a chase owes before it parks", () => {
  it("refuses a bump on a closed pull request, the last line saying nothing parked", async () => {
    const fake = readAnswering({ state: { kind: "settled", state: "CLOSED" } });
    const held = await settledChaseHold({
      deps: { pullRequestState: fake.read },
      options: { act: "bump", home: "/home" },
      payload: PAYLOAD,
    });
    const lines = unwrapErr(held);
    expect(lines[0]).toContain(
      "this bump links https://github.com/acme/acme-admin/pull/18404, which GitHub says is already closed",
    );
    expect(lines.at(-1)).toBe(NOTHING_PARKED);
    expect(fake.asked).toEqual(["acme/acme-admin#18404"]);
  });

  it("passes a bump whose pull request is still open", async () => {
    const fake = readAnswering({ state: { kind: "open" } });
    const held = await settledChaseHold({
      deps: { pullRequestState: fake.read },
      options: { act: "bump", home: "/home" },
      payload: PAYLOAD,
    });
    expect(unwrap(held)).toBe(true);
    expect(fake.asked).toEqual(["acme/acme-admin#18404"]);
  });

  it("refuses a bump whose pull-request link names no readable number, reading nothing", async () => {
    const url = "https://github.com/acme/acme-admin/pull/latest";
    const held = await settledChaseHold({
      deps: { pullRequestState: unreachable },
      options: { act: "bump", home: "/home" },
      payload: { text: `bumping this one: <${url}|the PR>` },
    });
    expect(unwrapErr(held)).toEqual([ChaseSubjectErrors.unnamed({ act: "bump", url }).message, NOTHING_PARKED]);
  });

  it("reads nothing for a reply, whose subject is not a chase", async () => {
    const held = await settledChaseHold({
      deps: { pullRequestState: unreachable },
      options: { act: "reply", home: "/home" },
      payload: PAYLOAD,
    });
    expect(unwrap(held)).toBe(true);
  });
});
