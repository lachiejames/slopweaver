/**
 * `draftSentProof.ts` — a drop's `sent …` note is read against Slack before anything is dropped: it passes only when
 * the row's author posted the row's words at every ref, and fails closed with no token or a failed read. The register and Slack are plain fakes.
 */
import { describe, expect, it } from "vitest";

import type { SlackDraftDeps } from "../../../../../cli/commands/slack/draftRun.js";
import { sentNoteRefusal } from "../../../../../cli/commands/slack/draftSentProof.js";
import { err, ok } from "../../../../../lib/result.js";
import { SlackDraftErrors } from "../../../../../outbound/slack/draftErrors.js";
import { slackDraftEventLine } from "../../../../../outbound/slack/draftRegister.js";
import { draftItem } from "../../../supervisor/draftItemFixture.js";

const ID = "sd-c57b4ade";
const AUTHOR = "U0SYN000001";
const PARKED_AT = "2026-10-08T00:10:00.000Z";
const NOTE = "sent C0123456789 1791418800.000100";
const PARK = slackDraftEventLine({
  event: {
    draft: { ...draftItem({ id: ID, tsIso: PARKED_AT }).draft, authorId: AUTHOR },
    id: ID,
    kind: "parked",
    tsIso: PARKED_AT,
  },
});
const SENT = { text: "sounds good", ts: "1791418800.000100", type: "message", user: AUTHOR };

/** Slack fakes over a register of the one park, recording which token each read went under. */
function slack({
  read,
  tokenless = false,
}: {
  read: Awaited<ReturnType<SlackDraftDeps["threadReplies"]>>;
  tokenless?: boolean;
}) {
  const tokens: string[] = [];
  const deps: Pick<SlackDraftDeps, "botToken" | "readLog" | "threadReplies" | "userToken"> = {
    botToken: () => "xoxb-test",
    readLog: () => [PARK],
    threadReplies: async ({ token: used }) => {
      tokens.push(used);
      return read;
    },
    userToken: () => (tokenless ? undefined : "xoxp-test"),
  };
  return { deps, tokens };
}

describe("sentNoteRefusal", () => {
  it("passes a note Slack bears out, reading under the row's own (user) token", async () => {
    const { deps, tokens } = slack({ read: ok([SENT]) });

    expect(await sentNoteRefusal({ deps, home: "/tmp/no-home", id: ID, note: NOTE })).toBeUndefined();
    expect(tokens).toEqual(["xoxp-test"]);
  });

  it("refuses when Slack holds other words at the ref", async () => {
    const { deps } = slack({ read: ok([{ ...SENT, text: "another reply" }]) });

    expect(await sentNoteRefusal({ deps, home: "/tmp/no-home", id: ID, note: NOTE })).toContain(
      "Slack does not hold these words there under its author",
    );
  });

  it("refuses, failing closed, when the read fails or there is no token to read under", async () => {
    const failed = slack({
      read: err(
        SlackDraftErrors.threadUnreadable({
          cause: new Error("ECONNRESET"),
          channel: "C0123456789",
          threadTs: "1791418800.000100",
        }),
      ),
    });
    const tokenless = slack({ read: ok([SENT]), tokenless: true });

    expect(await sentNoteRefusal({ deps: failed.deps, home: "/tmp/no-home", id: ID, note: NOTE })).toContain(
      "did not read",
    );
    expect(await sentNoteRefusal({ deps: tokenless.deps, home: "/tmp/no-home", id: ID, note: NOTE })).toContain(
      "there is no Slack token",
    );
    expect(tokenless.tokens).toEqual([]);
  });

  it("reads nothing for a note that is not a send record, or a row the register does not hold", async () => {
    const { deps, tokens } = slack({ read: ok([]) });

    expect(await sentNoteRefusal({ deps, home: "/tmp/no-home", id: ID, note: "moot: Seth answered" })).toBeUndefined();
    expect(await sentNoteRefusal({ deps, home: "/tmp/no-home", id: "sd-00000000", note: NOTE })).toBeUndefined();
    expect(tokens).toEqual([]);
  });
});
