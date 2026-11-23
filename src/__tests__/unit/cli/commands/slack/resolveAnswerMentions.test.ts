/**
 * `resolveAnswerMentions` — the answer form's own mention resolution, the twin of the update card's.
 *
 * It exists because `slack edit` can now re-render an ANSWER card in place, and an answer keeps its
 * below-fold blocks in `body` where a card keeps them in `detail`. The property under test is that BOTH
 * regions are read: an answer that tags its asker above the fold and names a second colleague below it must
 * refuse on the one that cannot resolve, whichever region that mention sits in. The pre-render check is
 * what turns `renderAssistantAnswer`'s `UnresolvedMentionError` crash into a usage error naming the person.
 */
import { describe, expect, it } from "vitest";

import type { LifecycleDeps } from "../../../../../cli/commands/slack/lifecycleRun.js";
import { resolveAnswerMentions } from "../../../../../cli/commands/slack/lifecycleRunGuards.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import type { MentionResolution } from "../../../../../outbound/slack/mentionIndex.js";
import { IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";

/** A resolution that knows exactly the people named, and nobody else. */
function resolutionOf({ known }: { known: readonly string[] }): MentionResolution {
  return {
    groupAddresses: new Map(),
    heldRequested: [],
    memberLookups: new Map(),
    resolved: new Map(known.map((person) => [person, { origin: "override", slackId: person }])),
    roster: {
      addressableKeys: known.length,
      collisions: [],
      derivedPeople: known.length,
      freshness: { kind: "fresh" },
      heldPeople: 0,
    },
  };
}

/** The one dependency this function reaches for, with everything else a landmine. */
function depsKnowing({ known }: { known: readonly string[] }): LifecycleDeps {
  return new Proxy(
    { resolveMentions: async () => ok(resolutionOf({ known })) },
    {
      get: (target, property) =>
        property in target
          ? (target as unknown as Record<string, unknown>)[property as string]
          : () => {
              throw new Error(`resolveAnswerMentions touched dependency \`${String(property)}\` it should not need`);
            },
    },
  ) as unknown as LifecycleDeps;
}

/** A minimal answer form with a mention in whichever region the caller asks for. */
function answerWith({
  indexPerson,
  bodyPerson,
}: {
  indexPerson: string | null;
  bodyPerson: string | null;
}): AnswerFormAnswer {
  return {
    body:
      bodyPerson === null
        ? [{ runs: [{ text: "plain prose", type: "text" }], type: "paragraph" }]
        : [{ runs: [{ person: bodyPerson, type: "mention" }], type: "paragraph" }],
    citations: [],
    grounding: { kind: "conversation" },
    images: [],
    index: indexPerson === null ? [] : [[{ person: indexPerson, type: "mention" }]],
    kind: "answer",
    lead: "a lead",
  } as unknown as AnswerFormAnswer;
}

describe("resolveAnswerMentions", () => {
  it("resolves a mention in the index, which is where an answer tags its asker", async () => {
    const resolved = unwrap(
      await resolveAnswerMentions({
        answer: answerWith({ bodyPerson: null, indexPerson: "seth" }),
        deps: depsKnowing({ known: ["seth"] }),
        home: "/nowhere",
      }),
    );
    expect(resolved.resolved.get("seth")!.slackId).toBe("seth");
  });

  it("reads the BODY region too, so a mention below the fold cannot slip past unresolved", async () => {
    const failure = unwrapErr(
      await resolveAnswerMentions({
        answer: answerWith({ bodyPerson: "nobody", indexPerson: null }),
        deps: depsKnowing({ known: ["seth"] }),
        home: "/nowhere",
      }),
    );
    expect(failure.join(" ")).toContain("nobody");
  });

  it("refuses the whole form when one of two mentions cannot resolve", async () => {
    const failure = unwrapErr(
      await resolveAnswerMentions({
        answer: answerWith({ bodyPerson: "ghost", indexPerson: "seth" }),
        deps: depsKnowing({ known: ["seth"] }),
        home: "/nowhere",
      }),
    );
    expect(failure.join(" ")).toContain("ghost");
  });

  it("passes a form that mentions nobody at all", async () => {
    const resolved = unwrap(
      await resolveAnswerMentions({
        answer: answerWith({ bodyPerson: null, indexPerson: null }),
        deps: depsKnowing({ known: [] }),
        home: "/nowhere",
      }),
    );
    expect(resolved.resolved.size).toBe(0);
  });

  it("refuses with the roster's own message when the store cannot say who anyone is", async () => {
    const outage = IdentityRosterErrors.storeUnavailable({ doing: "be opened", reason: "no database is selected" });
    const deps = { resolveMentions: async () => err(outage) } as unknown as LifecycleDeps;
    const failure = unwrapErr(
      await resolveAnswerMentions({
        answer: answerWith({ bodyPerson: null, indexPerson: "seth" }),
        deps,
        home: "/nowhere",
      }),
    );
    expect(failure).toEqual([outage.message]);
  });
});
