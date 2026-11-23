/**
 * How the register refuses and names: `slackDraftById` says which check refused, `mintSlackDraftId` keeps its
 * prefix, and every `SlackDraftErrors` refusal says what failed and what to do next.
 */
import { describe, expect, it } from "vitest";

import { mintSlackDraftId } from "../../../../../admit/slackDraftStore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { SlackDraftErrors } from "../../../../../outbound/slack/draftErrors.js";
import { foldSlackDrafts } from "../../../../../outbound/slack/draftFold.js";
import { slackDraftById } from "../../../../../outbound/slack/draftRegister.js";
import { draft } from "./fixtures.js";

describe("slackDraftById — which check refused", () => {
  it("names the id when no row carries it", () => {
    const result = slackDraftById({ id: "sd-nothing", items: [], mustBeHeld: true });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result).code).toBe("DRAFT_NOT_FOUND");
    expect(unwrapErr(result).message).toContain("sd-nothing");
  });

  it("refuses a released row for a release, and still hands it back for a read", () => {
    const parked = draft();
    const items = foldSlackDrafts({
      events: [
        { draft: parked, id: parked.id, kind: "parked", tsIso: parked.tsIso },
        { channel: "C0ISO", id: parked.id, kind: "released", ts: "1758500000.1", tsIso: "2026-09-23T01:00:00.000Z" },
      ],
    });
    const forRelease = slackDraftById({ id: parked.id, items, mustBeHeld: true });
    expect(forRelease.isOk()).toBe(false);
    expect(unwrapErr(forRelease).code).toBe("DRAFT_SPENT");
    expect(unwrapErr(forRelease).message).toContain("already released");
    expect(unwrap(slackDraftById({ id: parked.id, items, mustBeHeld: false })).state).toBe("released");
  });
});

describe("mintSlackDraftId", () => {
  it("prefixes `sd-` so a parked post is never mistaken for a `q-` withheld reply", () => {
    expect(mintSlackDraftId().startsWith("sd-")).toBe(true);
    expect(mintSlackDraftId()).not.toBe(mintSlackDraftId());
  });
});

describe("SlackDraftErrors — every refusal says which check failed, and what to do next", () => {
  it("names the recorded digest and the one offered, so a mismatch is diagnosable without the log", () => {
    const error = SlackDraftErrors.digestMismatch({ id: "sd-1", offered: "bbbb", recorded: "aaaa" });
    expect(error.code).toBe("DRAFT_DIGEST_MISMATCH");
    expect(error.recorded).toBe("aaaa");
    expect(error.offered).toBe("bbbb");
    expect(error.message).toContain("re-record it and read the new one before releasing");
  });

  it("points a missing id at the verb that lists the held ones", () => {
    expect(SlackDraftErrors.notFound({ id: "sd-nothing" }).message).toContain("slopweaver slack draft list");
  });

  it("says which way a spent row went, because released and dropped are not the same news", () => {
    const error = SlackDraftErrors.spent({ id: "sd-1", outcome: undefined, state: "released" });
    expect(error.state).toBe("released");
    expect(error.message).toContain("already released");
  });

  it("names where a spent row went, so a second send is refused with the message it would repeat", () => {
    const error = SlackDraftErrors.spent({
      id: "sd-1",
      outcome: "C0SYN000003 1790604264.247109 · https://acme.slack.com/archives/C0SYN000003/p1790604264247109",
      state: "released",
    });
    expect(error.message).toBe(
      "as-me draft sd-1 was already released (C0SYN000003 1790604264.247109 · " +
        "https://acme.slack.com/archives/C0SYN000003/p1790604264247109); a spent row is never performed twice",
    );
  });

  it("says NOTHING WAS PARKED on a failed write, which is the fact the caller has to report", () => {
    const error = SlackDraftErrors.writeFailed({ cause: new Error("EACCES"), path: "/nope/slack-drafts.jsonl" });
    expect(error.path).toBe("/nope/slack-drafts.jsonl");
    expect(error.message).toContain("so nothing was parked");
    expect(error.message).toContain("EACCES");
  });
});
