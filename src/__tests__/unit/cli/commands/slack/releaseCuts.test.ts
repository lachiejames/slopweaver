/*
 * What a release does to the other held cuts of its message: it spends a copy of the same words, keeps a cut that only
 * opens alike, and drops each spent cut with a note naming the released row.
 */

import { describe, expect, it } from "vitest";

import { releaseHeldCuts, spendHeldCuts } from "../../../../../cli/commands/slack/releaseCuts.js";
import type { SlackWriteDeps } from "../../../../../cli/commands/slack/run.js";
import { err, ok } from "../../../../../lib/result.js";
import { SlackDraftErrors } from "../../../../../outbound/slack/draftErrors.js";
import type { SlackDraftEvent, SlackDraftItem } from "../../../../../outbound/slack/draftRegister.js";

const OPENING = "Weekly security update for the production environment, read before the change window:";

/** A held row in one place carrying these words, its digest standing for them. */
function held({ id, text }: { id: string; text: string }): SlackDraftItem {
  return {
    draft: {
      advisory: [],
      authorId: "U0SYN000001",
      channel: "C0123456789",
      digest: `digest of ${text}`,
      form: "{}",
      id,
      mentions: [],
      payload: { form: "plain", text, unfurl_links: false, unfurl_media: false },
      shape: "top-level",
      tsIso: "2026-10-08T00:00:00.000Z",
      why: "the row under test",
    },
    id,
    state: "held",
  };
}

describe("releaseHeldCuts", () => {
  it("spends a copy of the same words and keeps a cut that only opens alike", () => {
    const released = held({ id: "sd-0000000a", text: `${OPENING}\nnothing to patch` });
    const copy = held({ id: "sd-0000000b", text: `${OPENING}\nnothing to patch` });
    const alike = held({ id: "sd-0000000c", text: `${OPENING}\ntwo hosts to patch` });

    expect(releaseHeldCuts({ draft: released, items: [released, copy, alike] })).toEqual(["sd-0000000b"]);
  });
});

describe("spendHeldCuts", () => {
  /** A world recording each append, failing the ones named. */
  function world({ fails = [] }: { fails?: readonly string[] }) {
    const appended: SlackDraftEvent[] = [];
    const deps: Pick<SlackWriteDeps, "appendDraftEvent"> = {
      appendDraftEvent: ({ event }) => {
        if (fails.includes(event.id)) {
          return err(SlackDraftErrors.writeFailed({ cause: new Error("EACCES"), path: "/x" }));
        }
        appended.push(event);
        return ok(true as const);
      },
    };
    return { appended, deps };
  }
  const draft = held({ id: "sd-0000000a", text: "the released words" }).draft;

  it("drops each cut with a note naming the released row", () => {
    const { appended, deps } = world({});

    expect(spendHeldCuts({ deps, draft, heldCuts: ["sd-0000000b"], home: "/h", ts: "1.2" })).toBe(true);
    expect(appended.map((event) => [event.kind, event.id])).toEqual([["dropped", "sd-0000000b"]]);
    expect(appended.flatMap((event) => (event.kind === "dropped" ? [event.note] : []))).toEqual([
      "superseded by sd-0000000a, released as C0123456789 1.2 — the same message",
    ]);
  });

  it("answers false when a drop fails, and still spends the rest", () => {
    const { appended, deps } = world({ fails: ["sd-0000000b"] });

    expect(spendHeldCuts({ deps, draft, heldCuts: ["sd-0000000b", "sd-0000000c"], home: "/h", ts: "1.2" })).toBe(false);
    expect(appended.map((event) => event.id)).toEqual(["sd-0000000c"]);
  });
});
