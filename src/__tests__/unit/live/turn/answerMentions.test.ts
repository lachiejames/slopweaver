/**
 * `resolveAnswerMentions` over an injected resolver: the keys it derives from the answer and hands over in
 * one call, the order its three refusals are judged in (missing people, refused groups, a stale roster), and
 * the renderable ids a clean resolution yields.
 *
 * Every resolution is built through the real pure `resolveMentionKeys`, so what the fake hands back is a
 * resolution the production layers could have produced.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  type AnswerMentionResolver,
  resolveAnswerMentions,
  resolveAnswerMentionsFromSnapshot,
} from "../../../../live/turn/answerMentions.js";
import { TurnErrors } from "../../../../live/turn/turnErrors.js";
import type { AnswerFormAnswer } from "../../../../outbound/assistant/answerForm.js";
import { addressableGroups } from "../../../../outbound/slack/groupIndex.js";
import { groupRefusals, type MentionResolution, resolveMentionKeys } from "../../../../outbound/slack/mentionIndex.js";
import type { DeriveFreshness } from "../../../../silver/derive/freshness.js";
import type { DerivedRoster } from "../../../../silver/derivedRoster.js";
import type { MentionGroup } from "../../../../silver/groupMention.js";
import type { IdentityRosterSnapshot } from "../../../../silver/identityRoster.js";
import { IdentityRosterErrors } from "../../../../silver/identityRosterErrors.js";
import { memoryIdentityRosterPort } from "../../../identityRosterFixture.js";

const HOME = "/fixture/home";
const ASKED_AT = "2026-10-13T09:00:00.000Z";
/** The door the answer hands its resolver; the resolver here is a fake, so the port is never read. */
const PORT = memoryIdentityRosterPort();

/** One user group, addressable by its handle and refused by its display name. */
const ENGINEERS: MentionGroup = {
  deleted: false,
  handle: "engineers",
  id: "S_ENGINEERS",
  memberIds: ["U_ONE"],
  name: "Engineering",
};

/** A derived roster holding one colleague, `ada-l`, with a Slack identity. */
const ROSTER: DerivedRoster = {
  heldPersonIds: new Set(),
  people: [
    {
      confidence: "email",
      id: "p-ada",
      identities: [{ handle: "ada-l", name: "Ada Lovelace", nativeId: "U_ADA", source: "slack" }],
      kind: "person",
    },
  ],
};

/**
 * A valid answer whose index line mentions the given people and groups, in that order.
 *
 * @returns the answer
 */
function answerMentioning({
  people,
  groups,
}: {
  people: readonly string[];
  groups: readonly string[];
}): AnswerFormAnswer {
  return {
    body: [],
    citations: [],
    documents: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [] },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "conversation",
      provenance: {
        model: "the dispatched worker in workspace:1 (Claude Code, in-turn)",
        skillsLoaded: [],
        verbsLoaded: [],
      },
      reason: "answered from the thread",
    },
    images: [],
    index: [
      [
        { text: "over to ", type: "text" },
        ...people.map((person) => ({ person, type: "mention" as const })),
        ...groups.map((handle) => ({ handle, type: "group" as const })),
      ],
    ],
    kind: "answer",
    lead: "the pool exhausted at 03:00Z",
    measurements: [],
  };
}

/**
 * A resolution of the given keys against {@link ROSTER}, as the real pure resolver builds it.
 *
 * @returns the resolution
 */
function resolutionOf({
  people,
  groups,
  freshness,
}: {
  people: readonly string[];
  groups: readonly string[];
  freshness: DeriveFreshness;
}): MentionResolution {
  return resolveMentionKeys({
    derived: ROSTER,
    freshness,
    groupAddresses: addressableGroups({ groups: [ENGINEERS], keys: groups }),
    overrides: [],
    people,
  });
}

/**
 * A resolver that answers with one fixed resolution and records each input it was given.
 *
 * @returns the seam and its recorded inputs
 */
function recordingResolver({ resolution }: { resolution: MentionResolution }): {
  readonly resolveMentions: AnswerMentionResolver;
  readonly inputs: unknown[];
} {
  const inputs: unknown[] = [];
  const resolveMentions: AnswerMentionResolver = async (input) => {
    inputs.push(input);
    return ok(resolution);
  };
  return { inputs, resolveMentions };
}

describe("resolveAnswerMentions", () => {
  it("hands the answer's mentioned people and addressed groups, the home and the instant to one resolver call", async () => {
    const seam = recordingResolver({
      resolution: resolutionOf({ freshness: { kind: "fresh" }, groups: ["@engineers"], people: ["ada-l"] }),
    });

    await resolveAnswerMentions({
      answer: answerMentioning({ groups: ["@engineers"], people: ["ada-l", "ada-l"] }),
      askedAtIso: ASKED_AT,
      home: HOME,
      identityRoster: PORT,
      resolveMentions: seam.resolveMentions,
    });

    expect(seam.inputs).toEqual([
      { askedAtIso: ASKED_AT, groups: ["@engineers"], home: HOME, identityRoster: PORT, people: ["ada-l"] },
    ]);
  });

  it("refuses with MENTIONS_REFUSED carrying the roster's own message and code when the identity roster cannot be read", async () => {
    const outage = IdentityRosterErrors.storeUnavailable({ doing: "be opened", reason: "disk full" });
    const resolveMentions: AnswerMentionResolver = async () => err(outage);

    const resolved = await resolveAnswerMentions({
      answer: answerMentioning({ groups: [], people: ["ada-l"] }),
      askedAtIso: ASKED_AT,
      home: HOME,
      identityRoster: PORT,
      resolveMentions,
    });

    expect(unwrapErr(resolved)).toEqual(TurnErrors.mentionsRosterUnread({ error: outage }));
    expect(unwrapErr(resolved)).toEqual({
      code: "MENTIONS_REFUSED",
      message: outage.message,
      reasons: [outage.message],
      rosterCode: "IDENTITY_ROSTER_STORE_UNAVAILABLE",
    });
  });

  it("refuses with MENTIONS_REFUSED naming the unresolved person before judging groups or staleness", async () => {
    const seam = recordingResolver({
      resolution: resolutionOf({
        freshness: { kind: "absent", why: "it has never been derived" },
        groups: ["Engineering"],
        people: ["ada-l", "nobody"],
      }),
    });

    const resolved = await resolveAnswerMentions({
      answer: answerMentioning({ groups: ["Engineering"], people: ["ada-l", "nobody"] }),
      askedAtIso: ASKED_AT,
      home: HOME,
      identityRoster: PORT,
      resolveMentions: seam.resolveMentions,
    });

    expect(resolved.isErr()).toBe(true);
    expect(unwrapErr(resolved)).toEqual(TurnErrors.mentionsUnresolved({ missing: ["nobody"] }));
    expect(unwrapErr(resolved).code).toBe("MENTIONS_REFUSED");
    expect(unwrapErr(resolved).message).toBe("the answer mentions nobody, which do not resolve in the identity map");
  });

  it("refuses with MENTIONS_REFUSED carrying the group refusal when every person resolves", async () => {
    const resolution = resolutionOf({ freshness: { kind: "fresh" }, groups: ["Engineering"], people: ["ada-l"] });
    const seam = recordingResolver({ resolution });

    const resolved = await resolveAnswerMentions({
      answer: answerMentioning({ groups: ["Engineering"], people: ["ada-l"] }),
      askedAtIso: ASKED_AT,
      home: HOME,
      identityRoster: PORT,
      resolveMentions: seam.resolveMentions,
    });

    expect(resolved.isErr()).toBe(true);
    expect(unwrapErr(resolved)).toEqual(TurnErrors.mentionsRefused({ reasons: groupRefusals({ resolution }) }));
    expect(unwrapErr(resolved).code).toBe("MENTIONS_REFUSED");
    expect(unwrapErr(resolved).message).toContain("display NAME, not its handle");
  });

  it("refuses with MENTIONS_REFUSED carrying the stale-roster reason when people and groups all resolve", async () => {
    const seam = recordingResolver({
      resolution: resolutionOf({
        freshness: { kind: "absent", why: "it has never been derived" },
        groups: [],
        people: ["ada-l"],
      }),
    });

    const resolved = await resolveAnswerMentions({
      answer: answerMentioning({ groups: [], people: ["ada-l"] }),
      askedAtIso: ASKED_AT,
      home: HOME,
      identityRoster: PORT,
      resolveMentions: seam.resolveMentions,
    });

    expect(resolved.isErr()).toBe(true);
    const staleReason =
      "the derived identity roster (corpus/silver/index/identities.json) cannot be trusted: it has never " +
      "been derived — refusing rather than sending against stale state. `slopweaver derive` has already " +
      "run and did not make it fresh. Run `slopweaver derive`, then retry.";
    expect(unwrapErr(resolved)).toEqual(TurnErrors.mentionsRefused({ reasons: [staleReason] }));
    expect(unwrapErr(resolved).code).toBe("MENTIONS_REFUSED");
    expect(unwrapErr(resolved).message).toBe(staleReason);
  });

  it("returns the renderable person and group ids when everything resolves on a fresh roster", async () => {
    const seam = recordingResolver({
      resolution: resolutionOf({ freshness: { kind: "fresh" }, groups: ["@engineers"], people: ["ada-l"] }),
    });

    const resolved = await resolveAnswerMentions({
      answer: answerMentioning({ groups: ["@engineers"], people: ["ada-l"] }),
      askedAtIso: ASKED_AT,
      home: HOME,
      identityRoster: PORT,
      resolveMentions: seam.resolveMentions,
    });

    expect(resolved.isOk()).toBe(true);
    expect([...unwrap(resolved).people]).toEqual([["ada-l", "U_ADA"]]);
    expect([...unwrap(resolved).groups]).toEqual([["@engineers", "S_ENGINEERS"]]);
  });
});

describe("resolveAnswerMentionsFromSnapshot", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "answer-mentions-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** A roster row holding one person, `jonah-example`, carrying a Slack identity. */
  const JONAH_ROW: IdentityRosterSnapshot = {
    records: [
      {
        handle: "jonah-example",
        id: "person-jonah",
        identities: [{ nativeId: "U0JONAH", source: "slack" }],
        name: "Jonah Example",
      },
    ],
    retiredFile: undefined,
    revision: 3,
  };

  it("resolves a person off the snapshot it is handed, reading no port at all", () => {
    const resolved = resolveAnswerMentionsFromSnapshot({
      answer: answerMentioning({ groups: [], people: ["jonah-example"] }),
      askedAtIso: ASKED_AT,
      home,
      roster: JONAH_ROW,
    });

    expect([...unwrap(resolved).people]).toEqual([["jonah-example", "U0JONAH"]]);
  });

  it("refuses a person the snapshot does not hold, with the same refusal the port's path gives", () => {
    const resolved = resolveAnswerMentionsFromSnapshot({
      answer: answerMentioning({ groups: [], people: ["nobody"] }),
      askedAtIso: ASKED_AT,
      home,
      roster: JONAH_ROW,
    });

    expect(unwrapErr(resolved)).toEqual(TurnErrors.mentionsUnresolved({ missing: ["nobody"] }));
  });
});
