/*
 * What the Slack mention-index test files share: the derived-person and roster builders every case resolves
 * against, the empty human roster, and the bot's own declared identity. Pure fixtures, no I/O. They moved here
 * when `mentionIndex.test.ts` was split by behaviour.
 */
import type { DerivedPerson, DerivedRoster } from "../../../../../silver/derivedRoster.js";
import type { IdentityRecord } from "../../../../../silver/identity.js";

/**
 * A derived person with a Slack identity plus a GitHub one — the shape derive really persists.
 *
 * @returns a derived person carrying a GitHub identity, plus a Slack one when `slackId` is given
 */
export function person({
  id,
  handle,
  slackId,
  email,
}: {
  id: string;
  handle: string;
  slackId?: string;
  email?: string;
}): DerivedPerson {
  return {
    confidence: "email",
    id,
    identities: [
      { handle: `${handle}-gh`, nativeId: `${handle}-gh`, source: "github" },
      ...(slackId === undefined
        ? []
        : [
            {
              handle,
              name: `Display Name ${handle}`,
              nativeId: slackId,
              source: "slack" as const,
              ...(email === undefined ? {} : { email }),
            },
          ]),
    ],
    kind: "person",
  };
}

/**
 * A derived roster over the given people, with the named person ids held.
 *
 * @returns the roster `resolveMentionKeys` and `buildMentionIndex` read
 */
export function roster({
  people,
  held = [],
}: {
  people: readonly DerivedPerson[];
  held?: readonly string[];
}): DerivedRoster {
  return { heldPersonIds: new Set(held), people };
}

export const NO_OVERRIDES: readonly IdentityRecord[] = [];

export const SELF_USER_IDS = ["U_fake_bot"];
