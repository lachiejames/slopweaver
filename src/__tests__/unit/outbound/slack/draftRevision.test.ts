/**
 * `draftRevision.ts` — a held as-me row's words revised or put back, every version kept, and the row's destination,
 * identity, thread and files fixed.
 */
import { describe, expect, it } from "vitest";

import type { DraftWords } from "../../../../outbound/slack/draftComparison.js";
import {
  type DraftApproval,
  parkedDraftDigest,
  type SlackDraftItem,
} from "../../../../outbound/slack/draftRegister.js";
import {
  type DraftRevisedEvent,
  draftVersions,
  revisedRow,
  revisionRefusal,
  sentRow,
} from "../../../../outbound/slack/draftRevision.js";

const CHANNEL = "C0123456789";
const AUTHOR = "U0SYNAUTHOR01";

/** Words bound to the row's own destination, the way the verb binds them. */
function words({ text, channel = CHANNEL }: { text: string; channel?: string }): DraftWords {
  const payload = { form: "plain", text, unfurl_links: false, unfurl_media: false } as const;
  const digest = parkedDraftDigest({
    draft: {
      authorId: AUTHOR,
      channel,
      media: undefined,
      mentions: [],
      payload,
      priorAsk: undefined,
      threadTs: undefined,
    },
  });
  return {
    advisory: [],
    digest,
    form: JSON.stringify({ kind: "one-card", lines: [{ runs: [{ text }] }] }),
    mentions: [],
    payload,
  };
}

const V1 = words({ text: "Can you look at the pool?" });
const V2 = words({ text: "Hey, could you look at the pool when you get a sec?" });

/** A held as-me row carrying V1. */
function row({
  approval,
  state = "held",
}: { approval?: DraftApproval; state?: SlackDraftItem["state"] } = {}): SlackDraftItem {
  return {
    draft: {
      ...V1,
      authorId: AUTHOR,
      channel: CHANNEL,
      id: "sd-11112222",
      shape: "top-level",
      tsIso: "2026-10-04T04:30:00.000Z",
      why: "ask Seth about the pool",
      ...(approval === undefined ? {} : { approval }),
    },
    id: "sd-11112222",
    state,
  };
}

/** The revision event a voice edit appends. */
function revised({
  version,
  of,
  restoredFrom,
}: {
  version: number;
  of: DraftWords;
  restoredFrom?: number;
}): DraftRevisedEvent {
  return {
    heard: "make it warmer",
    id: "sd-11112222",
    kind: "revised",
    reading: ["Warmer opening"],
    tsIso: `2026-10-04T04:3${String(version)}:00.000Z`,
    version,
    words: of,
    ...(restoredFrom === undefined ? {} : { restoredFrom }),
  };
}

describe("revisedRow", () => {
  it("makes v2 current and keeps v1 as the words first seen", () => {
    const after = revisedRow({ event: revised({ of: V2, version: 2 }), standing: row() });
    expect(after.draft.payload).toEqual(V2.payload);
    expect(after.draft.digest).toBe(V2.digest);
    expect(after.draft.channel).toBe(CHANNEL);
    expect(after.versions!.map((version) => [version.number, version.words.digest])).toEqual([
      [1, V1.digest],
      [2, V2.digest],
    ]);
    expect(after.versions![0]!.atIso).toBe("2026-10-04T04:30:00.000Z");
    expect(after.versions![1]!.heard).toBe("make it warmer");
  });

  it("puts v1 back as v3, deleting nothing", () => {
    const two = revisedRow({ event: revised({ of: V2, version: 2 }), standing: row() });
    const three = revisedRow({ event: revised({ of: V1, restoredFrom: 1, version: 3 }), standing: two });
    expect(three.draft.digest).toBe(V1.digest);
    expect(three.versions!.map((version) => version.number)).toEqual([1, 2, 3]);
    expect(three.versions![2]!.restoredFrom).toBe(1);
  });

  it("shows a released row as the words its release sent, past a revision journalled mid-send", () => {
    const two = revisedRow({ event: revised({ of: V2, version: 2 }), standing: row() });
    const sent = sentRow({ digest: V1.digest, item: two });
    expect(sent.draft.digest).toBe(V1.digest);
    expect(sent.draft.payload).toEqual(V1.payload);
    expect(sent.versions!.map((version) => version.number)).toEqual([1, 2]);
    expect(sentRow({ digest: V2.digest, item: two })).toBe(two);
    expect(sentRow({ digest: undefined, item: two })).toBe(two);
    expect(sentRow({ digest: "a digest no version carries", item: two })).toBe(two);
  });

  it("ignores a version out of turn, a restore naming other words, and words bound to another channel", () => {
    const standing = row();
    expect(revisedRow({ event: revised({ of: V2, version: 3 }), standing })).toBe(standing);
    const two = revisedRow({ event: revised({ of: V2, version: 2 }), standing });
    expect(revisedRow({ event: revised({ of: V2, restoredFrom: 1, version: 3 }), standing: two })).toBe(two);
    // v1's digest and payload under another form: a release would re-prepare other words.
    const reformed = { ...V1, form: V2.form };
    expect(revisedRow({ event: revised({ of: reformed, restoredFrom: 1, version: 3 }), standing: two })).toBe(two);
    const elsewhere = words({ channel: "C0SYNOTHER0001", text: "Hey" });
    expect(revisedRow({ event: revised({ of: elsewhere, version: 2 }), standing })).toBe(standing);
  });

  it("ignores a revision of an approved or released row", () => {
    const approval = { anchor: "talk-call:x#turn_Y", atIso: "2026-10-04T04:31:00.000Z", heard: "send it" };
    const approved = row({ approval });
    expect(revisedRow({ event: revised({ of: V2, version: 2 }), standing: approved })).toBe(approved);
    const released = row({ state: "released" });
    expect(revisedRow({ event: revised({ of: V2, version: 2 }), standing: released })).toBe(released);
  });
});

describe("revisionRefusal and draftVersions", () => {
  it("names the step that frees an approved row, and refuses a bot row", () => {
    const approval = { anchor: "talk-call:x#turn_Y", atIso: "2026-10-04T04:31:00.000Z", heard: "send it" };
    expect(revisionRefusal({ item: row({ approval }) })).toContain(
      "slack draft hold sd-11112222 --reason not-owner-yes",
    );
    const bot = row();
    expect(revisionRefusal({ item: { ...bot, draft: { ...bot.draft, actor: "bot" } } })).toContain("as-me");
    expect(revisionRefusal({ item: row() })).toBeUndefined();
  });

  it("reads a never-revised row as its one version", () => {
    expect(draftVersions({ item: row() }).map((version) => [version.number, version.words.digest])).toEqual([
      [1, V1.digest],
    ]);
  });
});
