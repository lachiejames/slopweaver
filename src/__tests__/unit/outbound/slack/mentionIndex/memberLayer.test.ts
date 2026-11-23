import { describe, expect, it } from "vitest";

import {
  mentionRefusals,
  resolveMentionKeys,
  staleRosterRefusals,
} from "../../../../../outbound/slack/mentionIndex.js";
import type { MentionLookup, MentionPerson } from "../../../../../silver/mentionResolver.js";
import { NO_OVERRIDES, person, roster } from "./harness.js";

/**
 * The MEMBER layer — the one that removes this file's dependency on a `derive` that can refuse.
 *
 * A lookup is built by hand here rather than through `resolveMention`, because what is under test is what
 * this index DOES with a verdict, not how the verdict was reached (that is
 * `../../../silver/mentionResolver.test.ts`).
 */
function memberPerson({ name, slackId }: { name: string; slackId: string }): MentionPerson {
  return {
    active: true,
    bot: false,
    displayName: name,
    email: `${slackId}@example.test`,
    identities: [{ active: true, bot: false, name, nativeId: slackId, source: "slack" }],
    key: `${slackId}@example.test`,
    orgStatus: "org",
  };
}

/** One `resolved` member verdict for a key. */
function resolvedFor({ key, slackId }: { key: string; slackId: string }): ReadonlyMap<string, MentionLookup> {
  const matched = memberPerson({ name: key, slackId });
  return new Map([[key, { kind: "resolved", match: { person: matched, tier: "given-name" }, nativeId: slackId }]]);
}

describe("the member layer", () => {
  it("resolves a key the derived roster has never heard of", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: { kind: "fresh" },
      memberLookups: resolvedFor({ key: "wren", slackId: "U_fake_wren" }),
      overrides: NO_OVERRIDES,
      people: ["wren"],
    });

    expect(resolution.resolved.get("wren")).toEqual({ origin: "member", slackId: "U_fake_wren" });
  });

  it("outranks the derived roster, because a member row is the provider's own answer", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [person({ handle: "wren", id: "wren", slackId: "U_fake_stale" })] }),
      freshness: { kind: "fresh" },
      memberLookups: resolvedFor({ key: "wren", slackId: "U_fake_current" }),
      overrides: NO_OVERRIDES,
      people: ["wren"],
    });

    expect(resolution.resolved.get("wren")).toEqual({ origin: "member", slackId: "U_fake_current" });
  });

  it("blocks the derived roster from answering a key the member layer REFUSED", () => {
    const ambiguous: ReadonlyMap<string, MentionLookup> = new Map([
      [
        "wren",
        {
          kind: "ambiguous",
          matches: [
            { person: memberPerson({ name: "Wren One", slackId: "U_fake_1" }), tier: "given-name" },
            { person: memberPerson({ name: "Wren Two", slackId: "U_fake_2" }), tier: "given-name" },
          ],
          tier: "given-name",
        },
      ],
    ]);
    const resolution = resolveMentionKeys({
      derived: roster({ people: [person({ handle: "wren", id: "wren", slackId: "U_fake_guess" })] }),
      freshness: { kind: "fresh" },
      memberLookups: ambiguous,
      overrides: NO_OVERRIDES,
      people: ["wren"],
    });

    expect(resolution.resolved.has("wren")).toBe(false);
    expect(mentionRefusals({ missing: ["wren"], resolution })[0]).toContain("2 colleagues answer to it");
  });

  it("still lets a HUMAN confirmation overrule a member refusal — every refusal keeps a way out", () => {
    const external: ReadonlyMap<string, MentionLookup> = new Map([
      [
        "wren",
        {
          kind: "external",
          matches: [{ person: memberPerson({ name: "Wren", slackId: "U_fake_x" }), tier: "handle" }],
        },
      ],
    ]);
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: { kind: "fresh" },
      memberLookups: external,
      overrides: [
        { handle: "wren", id: "p-wren", identities: [{ nativeId: "U_fake_confirmed", source: "slack" }], name: "Wren" },
      ],
      people: ["wren"],
    });

    expect(resolution.resolved.get("wren")).toEqual({ origin: "override", slackId: "U_fake_confirmed" });
  });
});

describe("a stale roster no longer holds a send the member layer settled", () => {
  const STALE = { kind: "absent", why: "it has never been derived" } as const;

  it("does not refuse when every mention resolved from the member index", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: STALE,
      memberLookups: resolvedFor({ key: "wren", slackId: "U_fake_wren" }),
      overrides: NO_OVERRIDES,
      people: ["wren"],
    });

    expect(staleRosterRefusals({ people: ["wren"], resolution })).toEqual([]);
  });

  it("does not refuse a mention the HUMAN roster confirmed, so identity.json is a remedy that works", () => {
    // The generic refusal tells a reader to confirm the key in identity.json. Before this, doing exactly
    // that resolved the mention and the send was refused anyway, on a derived roster it had stopped using.
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: STALE,
      overrides: [
        { handle: "wren", id: "person-wren", identities: [{ nativeId: "U_fake_wren", source: "slack" }], name: "Wren" },
      ],
      people: ["U_fake_wren"],
    });

    expect(resolution.resolved.get("U_fake_wren")).toEqual({ origin: "override", slackId: "U_fake_wren" });
    expect(staleRosterRefusals({ people: ["U_fake_wren"], resolution })).toEqual([]);
  });

  it("still refuses when a mention fell through to the derived roster", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: STALE,
      memberLookups: new Map(),
      overrides: NO_OVERRIDES,
      people: ["wren"],
    });

    expect(staleRosterRefusals({ people: ["wren"], resolution }).length).toBe(1);
  });
});
