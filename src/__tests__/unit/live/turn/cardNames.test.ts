import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildMemberIdentity } from "../../../../corpus/members/email.js";
import { writeMemberRows } from "../../../../corpus/members/store.js";
import type { MemberBronzeRow } from "../../../../corpus/members/types.js";
import { unwrap } from "../../../../lib/result.js";
import { cardNameLookup, frameTagIds, namedFrame, namedTags, personTagIds } from "../../../../live/turn/cardNames.js";

/** The owner's own tag, as the listener normalised it — what the card quoted. */
const OWNER_TAG = "add @(U0SYN000003) and @(U0SYN000015) to the whitelist, and also answer @(U0SYN000003)'s question";

function member({ nativeId, name }: { nativeId: string; name: string }): MemberBronzeRow {
  return {
    fetchedAtIso: "2026-09-01T00:00:00.000Z",
    identity: buildMemberIdentity({ handle: nativeId.toLowerCase(), name, nativeId, source: "slack" }),
    profile: {},
    provenance: [],
    raw: {},
    source: "slack",
    sourceId: nativeId,
    version: 1,
    warnings: [],
  };
}

describe("personTagIds", () => {
  it("lists every person tag once, first appearance first, and skips a user group", () => {
    expect(personTagIds({ text: `${OWNER_TAG} cc @(S0GROUP) @(W0SYNENTERPRISE)` })).toEqual([
      "U0SYN000003",
      "U0SYN000015",
      "W0SYNENTERPRISE",
    ]);
  });

  it("finds nothing in text that tags nobody", () => {
    expect(personTagIds({ text: "who is in the everyone group" })).toEqual([]);
  });
});

describe("namedTags", () => {
  it("names every resolved tag and leaves an unresolved one as its id", () => {
    expect(namedTags({ names: { U0SYN000003: "Ari" }, text: OWNER_TAG })).toBe(
      "add @Ari and @(U0SYN000015) to the whitelist, and also answer @Ari's question",
    );
  });

  it("is byte-identical when nothing resolves", () => {
    expect(namedTags({ names: {}, text: OWNER_TAG })).toBe(OWNER_TAG);
  });
});

describe("namedFrame", () => {
  it("names the task label, every step title and every detail, and leaves a step with no detail without one", () => {
    const names = { U0SYN000015: "Jared Wright Smith", U0SYN000003: "Ari" };
    const framed = namedFrame({
      names,
      steps: [
        { detail: `"${OWNER_TAG}"`, id: "read", state: "done", title: "Read the question" },
        { id: "ask", state: "running", title: "Ask @(U0SYN000003)" },
      ],
      task: "answering: add @(U0SYN000003) and @(U0SYN000015)",
    });
    expect(framed).toEqual({
      steps: [
        {
          detail: '"add @Ari and @Jared Wright Smith to the whitelist, and also answer @Ari\'s question"',
          id: "read",
          state: "done",
          title: "Read the question",
        },
        { id: "ask", state: "running", title: "Ask @Ari" },
      ],
      task: "answering: add @Ari and @Jared Wright Smith",
    });
  });

  it("collects the ids across the task, titles and details for one lookup", () => {
    expect(
      frameTagIds({
        steps: [{ detail: "@(U2) and @(U1)", id: "a", state: "done", title: "@(U3)" }],
        task: "answering: @(U1)",
      }),
    ).toEqual(["U1", "U3", "U2"]);
  });

  it("reaches the child lines too, where a live step's finding and a loop phase's updates ride", () => {
    const steps = [
      { children: ["asked @(U4)", "now: reading"], id: "loop-0", state: "done" as const, title: "started" },
    ];
    expect(frameTagIds({ steps, task: "answering" })).toEqual(["U4"]);
    expect(namedFrame({ names: { U4: "Ari" }, steps, task: "answering" }).steps[0]!.children).toEqual([
      "asked @Ari",
      "now: reading",
    ]);
  });
});

describe("cardNameLookup", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "card-names-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("names the ids member bronze holds and omits the rest", () => {
    unwrap(
      writeMemberRows({
        home,
        rows: [member({ name: "Ari", nativeId: "U0SYN000003" })],
        source: "slack",
      }),
    );
    const names = cardNameLookup({ home });
    expect(names({ ids: ["U0SYN000003", "U0SYN000015"] })).toEqual({ U0SYN000003: "Ari" });
  });

  it("reads member bronze once, so a name written after the first frame is not seen by the same card", () => {
    unwrap(writeMemberRows({ home, rows: [member({ name: "Ari", nativeId: "U0A" })], source: "slack" }));
    const names = cardNameLookup({ home });
    expect(names({ ids: ["U0A"] })).toEqual({ U0A: "Ari" });
    unwrap(writeMemberRows({ home, rows: [member({ name: "Jared", nativeId: "U0J" })], source: "slack" }));
    expect(names({ ids: ["U0A", "U0J"] })).toEqual({ U0A: "Ari" });
  });

  it("answers an empty map on a home with no member bronze at all", () => {
    expect(cardNameLookup({ home })({ ids: ["U0SYN000003"] })).toEqual({});
  });
});

describe("the bare `@U…` form quotedQuestion leaves for an unnamed raw mention", () => {
  it("is found and named like the normalised form, and an unresolved one is left exactly as it was", () => {
    const text = "ask @U0SYN000003 and @U0SYN000015";
    expect(personTagIds({ text })).toEqual(["U0SYN000003", "U0SYN000015"]);
    expect(namedTags({ names: { U0SYN000003: "Ari" }, text })).toBe("ask @Ari and @U0SYN000015");
  });

  it("leaves a short @-word that is not an id alone", () => {
    expect(personTagIds({ text: "@UX said hi to @Umbrella" })).toEqual([]);
  });
});
