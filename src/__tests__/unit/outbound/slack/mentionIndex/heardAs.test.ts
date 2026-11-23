import { describe, expect, it } from "vitest";

import { mentionRefusals, resolveMentionKeys } from "../../../../../outbound/slack/mentionIndex.js";
import type { IdentityRecord } from "../../../../../silver/identity.js";
import type { MentionLookup } from "../../../../../silver/mentionResolver.js";
import { NO_OVERRIDES, person, roster } from "./harness.js";

describe("a heard-as pin whose target the member index cannot resolve", () => {
  const pinnedMiss: ReadonlyMap<string, MentionLookup & { heardAsTarget: string }> = new Map([
    ["smitty", { heardAsTarget: "john@example.test", kind: "unknown" }],
  ]);

  it("refuses rather than letting the derived roster tag whoever else answers to the raw token", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [person({ handle: "orrin", id: "smitty", slackId: "U_fake_orrin" })] }),
      freshness: { kind: "fresh" },
      memberLookups: pinnedMiss,
      overrides: NO_OVERRIDES,
      people: ["smitty"],
    });

    expect(resolution.resolved.has("smitty")).toBe(false);
    expect(mentionRefusals({ missing: ["smitty"], resolution })[0]).toBe(
      '"smitty" is pinned heard-as john@example.test in the identity roster (slopweaver identity roster replace), but the member index does not resolve that target on slack.',
    );
  });

  it("names the pin alone, without sending the reader off to rebuild a roster that could not have helped", () => {
    const resolution = resolveMentionKeys({
      derived: roster({ people: [] }),
      freshness: { kind: "absent", why: "it has never been derived" },
      memberLookups: pinnedMiss,
      overrides: NO_OVERRIDES,
      people: ["smitty"],
    });

    expect(mentionRefusals({ missing: ["smitty"], resolution })).toEqual([
      '"smitty" is pinned heard-as john@example.test in the identity roster (slopweaver identity roster replace), but the member index does not resolve that target on slack.',
    ]);
  });
});

describe("a heard-as claim no single record can route", () => {
  it("refuses rather than letting the derived roster tag whoever else answers to the raw token", () => {
    const disputed: ReadonlyMap<string, MentionLookup & { heardAsUnaddressable: string }> = new Map([
      ["smitty", { heardAsUnaddressable: "2 records claim it (p-john, p-alice)", kind: "unknown" }],
    ]);
    const resolution = resolveMentionKeys({
      derived: roster({ people: [person({ handle: "orrin", id: "smitty", slackId: "U_fake_orrin" })] }),
      freshness: { kind: "fresh" },
      memberLookups: disputed,
      overrides: NO_OVERRIDES,
      people: ["smitty"],
    });

    expect(resolution.resolved.has("smitty")).toBe(false);
    expect(mentionRefusals({ missing: ["smitty"], resolution })[0]).toBe(
      '"smitty" cannot follow its heard-as pin in the identity roster (slopweaver identity roster replace): 2 records claim it (p-john, p-alice). Leave exactly one record claiming it, with an email or one Slack id.',
    );
  });
});

describe("a heard-as claim reaching the resolver on a lookup nobody routed", () => {
  it("still refuses, because the resolver reads the roster's claims itself", () => {
    const john: IdentityRecord = {
      email: "john@example.test",
      handle: "john",
      heardAs: ["smitty"],
      id: "p-john",
      identities: [{ nativeId: "U_fake_john", source: "slack" }],
      name: "John",
    };
    const resolution = resolveMentionKeys({
      derived: roster({ people: [person({ handle: "orrin", id: "smitty", slackId: "U_fake_orrin" })] }),
      freshness: { kind: "fresh" },
      memberLookups: new Map([["smitty", { kind: "unknown" }]]),
      overrides: [john],
      people: ["smitty"],
    });

    expect(resolution.resolved.has("smitty")).toBe(false);
    expect(mentionRefusals({ missing: ["smitty"], resolution })[0]).toBe(
      '"smitty" cannot follow its heard-as pin in the identity roster (slopweaver identity roster replace): its member lookup was never routed through the pin. Leave exactly one record claiming it, with an email or one Slack id.',
    );
  });
});
