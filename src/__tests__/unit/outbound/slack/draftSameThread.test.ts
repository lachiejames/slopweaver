/**
 * One thread's replies as the owner are ONE queue card: a reply into a thread already holding
 * one under the same identity refuses unless `--supersedes` names every held reply there.
 */
import { describe, expect, it } from "vitest";

import type { ParkedSlackDraft, SlackDraftItem } from "../../../../outbound/slack/draftRegister.js";
import { heldRepliesInThread, sameThreadRefusal } from "../../../../outbound/slack/draftSameThread.js";

const CHANNEL = "C0SYNPLATFORM1";
const THREAD = "1790566514.594969";

/** One row, a thread reply as the owner by default; `topLevel` makes it a post in the channel instead. */
function row({
  id,
  state = "held",
  channel = CHANNEL,
  threadTs = THREAD,
  topLevel = false,
  actor,
  tsIso = "2026-09-29T05:41:00.000Z",
}: {
  id: string;
  state?: SlackDraftItem["state"];
  channel?: string;
  threadTs?: string;
  topLevel?: boolean;
  actor?: "bot";
  tsIso?: string;
}): SlackDraftItem {
  const draft: ParkedSlackDraft = {
    advisory: [],
    channel,
    digest: `digest-${id}`,
    form: "{}",
    id,
    mentions: [],
    payload: { form: "plain", text: `reply ${id}`, unfurl_links: false, unfurl_media: false },
    shape: topLevel ? "top-level" : "thread",
    tsIso,
    why: "a reply under test",
    ...(topLevel ? {} : { threadTs }),
    ...(actor === undefined ? {} : { actor }),
  };
  return { draft, id, state };
}

describe("heldRepliesInThread — the held replies a new reply into one thread would sit beside", () => {
  it("keeps only held thread replies in that channel and thread under that identity, oldest first", () => {
    const items = [
      row({ id: "sd-00000003", tsIso: "2026-09-29T05:43:00.000Z" }),
      row({ id: "sd-00000001", tsIso: "2026-09-29T05:41:00.000Z" }),
      row({ id: "sd-0000000a", state: "released" }),
      row({ id: "sd-0000000b", state: "dropped" }),
      row({ id: "sd-0000000c", threadTs: "1790566599.000100" }),
      row({ channel: "C0SYNELSEWHERE", id: "sd-0000000d" }),
      row({ id: "sd-0000000e", topLevel: true }),
      row({ actor: "bot", id: "sd-0000000f" }),
    ];
    const held = heldRepliesInThread({ actor: "me", channel: CHANNEL, items, threadTs: THREAD });
    expect(held.map((item) => item.id)).toEqual(["sd-00000001", "sd-00000003"]);
  });

  it("reads a bot row as the bot's, so a bot reply sits only beside the bot's own", () => {
    const items = [row({ id: "sd-00000001" }), row({ actor: "bot", id: "sd-00000002" })];
    const held = heldRepliesInThread({ actor: "bot", channel: CHANNEL, items, threadTs: THREAD });
    expect(held.map((item) => item.id)).toEqual(["sd-00000002"]);
  });

  it("answers nothing over an empty register", () => {
    expect(heldRepliesInThread({ actor: "me", channel: CHANNEL, items: [], threadTs: THREAD })).toEqual([]);
  });
});

describe("sameThreadRefusal — a second card for one thread refuses, naming the merged re-cut", () => {
  it("passes a top-level recording without looking at the register", () => {
    const items = [row({ id: "sd-00000001" })];
    expect(sameThreadRefusal({ actor: "me", channel: CHANNEL, items, supersedes: [], threadTs: undefined })).toEqual(
      [],
    );
  });

  it("passes the first reply into a thread", () => {
    const items = [row({ id: "sd-0000000c", threadTs: "1790566599.000100" })];
    expect(sameThreadRefusal({ actor: "me", channel: CHANNEL, items, supersedes: [], threadTs: THREAD })).toEqual([]);
  });

  it("refuses a second reply as the owner, naming the held one and the exact --supersedes", () => {
    const items = [row({ id: "sd-00000001" })];
    expect(sameThreadRefusal({ actor: "me", channel: CHANNEL, items, supersedes: [], threadTs: THREAD })).toEqual([
      `slack draft record: REFUSING to park another reply as the owner into thread ${THREAD} in ${CHANNEL} — sd-00000001 is ` +
        "already held there, and one thread's replies are ONE queue card, merged into a single one.",
      "Compose ONE reply in the owner's voice that covers that draft and this one (read it with `slopweaver slack draft show " +
        "<id>`), then record it with --supersedes sd-00000001, which drops it the moment the merged reply parks.",
      "There is deliberately NO escape hatch: the merged re-cut is always available, and a second card for one thread " +
        "is the thing the owner's word removes.",
    ]);
  });

  it("names every held reply, oldest first, when several are already parked", () => {
    const items = [
      row({ id: "sd-00000002", tsIso: "2026-09-29T05:42:00.000Z" }),
      row({ id: "sd-00000001", tsIso: "2026-09-29T05:41:00.000Z" }),
    ];
    const lines = sameThreadRefusal({ actor: "me", channel: CHANNEL, items, supersedes: [], threadTs: THREAD });
    expect(lines[0]).toContain("sd-00000001, sd-00000002 are already held there");
    expect(lines[1]).toContain("--supersedes sd-00000001,sd-00000002, which drops them");
  });

  it("passes a merged reply whose --supersedes names every held reply there", () => {
    const items = [row({ id: "sd-00000001" }), row({ id: "sd-00000002" })];
    const supersedes = ["sd-00000002", "sd-00000001"];
    expect(sameThreadRefusal({ actor: "me", channel: CHANNEL, items, supersedes, threadTs: THREAD })).toEqual([]);
  });

  it("refuses a --supersedes that leaves one held reply out, naming the one left out", () => {
    const items = [row({ id: "sd-00000001" }), row({ id: "sd-00000002", tsIso: "2026-09-29T05:42:00.000Z" })];
    const lines = sameThreadRefusal({
      actor: "me",
      channel: CHANNEL,
      items,
      supersedes: ["sd-00000001"],
      threadTs: THREAD,
    });
    expect(lines[0]).toContain("— sd-00000002 is already held there");
    expect(lines[1]).toContain("--supersedes sd-00000001,sd-00000002,");
  });

  it("lets a bot reply park beside a held reply as the owner, since one post cannot go out under both names", () => {
    const items = [row({ id: "sd-00000001" })];
    expect(sameThreadRefusal({ actor: "bot", channel: CHANNEL, items, supersedes: [], threadTs: THREAD })).toEqual([]);
  });

  it("refuses a second bot reply in the bot's words", () => {
    const items = [row({ actor: "bot", id: "sd-00000001" })];
    const lines = sameThreadRefusal({ actor: "bot", channel: CHANNEL, items, supersedes: [], threadTs: THREAD });
    expect(lines[0]).toContain("another reply as the bot into thread");
  });
});
