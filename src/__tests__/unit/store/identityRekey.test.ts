/**
 * Resolving a person on their Google directory id as well as their email, over a renamed-email fixture.
 *
 * The defect this holds down: a person whose primary address changed in Google Workspace arrived as a draft
 * with a new email and the same google id, the email upsert inserted a second row, and `uq_person_google_id`
 * refused it — sinking the whole reconcile and naming an index rather than a person.
 */
import { describe, expect, it } from "vitest";

import { StoreErrors, storeErrorLines } from "../../../store/errors.js";
import type { PersonDraft } from "../../../store/identity/people.js";
import {
  type HeldPerson,
  personCollisionOf,
  planGoogleIdRekeys,
  rekeyTemporaryEmail,
} from "../../../store/identity/rekey.js";

const ADA_GOOGLE = "100000000000000000001";
const GRACE_GOOGLE = "100000000000000000002";
const ADA_ROW = "00000000-0000-4000-8000-00000000ada1";
const GRACE_ROW = "00000000-0000-4000-8000-00000000ace1";
const MEMBER_ROW = "00000000-0000-4000-8000-00000000b0b1";

/** A draft carrying only what a rekey reads beyond its defaults: Ada, under her NEW primary address. */
const draft = (over: Partial<PersonDraft> = {}): PersonDraft => ({
  active: true,
  displayName: "Ada Lovelace",
  email: "ada.lovelace@example.invalid",
  familyName: "Lovelace",
  githubId: null,
  githubLogin: null,
  givenName: "Ada",
  googleId: ADA_GOOGLE,
  linearDisplayName: null,
  linearUserId: null,
  notionUserId: null,
  orgUnitPath: null,
  slackUserId: null,
  title: null,
  ...over,
});

/** Ada's stored row under the address she held BEFORE the rename. */
const adaBefore: HeldPerson = { email: "ada@example.invalid", googleId: ADA_GOOGLE, id: ADA_ROW };

describe("planGoogleIdRekeys", () => {
  it("renames the row holding the google id in place, through a scratch address, when the email changed", () => {
    expect(planGoogleIdRekeys({ held: [adaBefore], people: [draft()] })).toEqual({
      collisions: [],
      rekeys: [
        {
          fromEmail: "ada@example.invalid",
          googleId: ADA_GOOGLE,
          personId: ADA_ROW,
          temporaryEmail: "rekey-100000000000000000001@identity-rekey.invalid",
          toEmail: "ada.lovelace@example.invalid",
        },
      ],
    });
  });

  it("does nothing for a person whose address did not change", () => {
    const plan = planGoogleIdRekeys({ held: [adaBefore], people: [draft({ email: "ada@example.invalid" })] });
    expect(plan).toEqual({ collisions: [], rekeys: [] });
  });

  it("does nothing for a draft with no google id, or one no stored row holds, which stays an ordinary insert", () => {
    const plan = planGoogleIdRekeys({
      held: [adaBefore],
      people: [
        draft({ email: "member@example.invalid", googleId: null }),
        draft({ googleId: "100000000000000000009" }),
      ],
    });
    expect(plan).toEqual({ collisions: [], rekeys: [] });
  });

  it("renames both rows of a two-person swap, keeping each uuid with its own google id", () => {
    const grace: HeldPerson = { email: "grace@example.invalid", googleId: GRACE_GOOGLE, id: GRACE_ROW };
    const plan = planGoogleIdRekeys({
      held: [adaBefore, grace],
      people: [
        draft({ email: "grace@example.invalid" }),
        draft({ displayName: "Grace Hopper", email: "ada@example.invalid", googleId: GRACE_GOOGLE }),
      ],
    });
    expect(plan.collisions).toEqual([]);
    expect(plan.rekeys.map((rekey) => [rekey.personId, rekey.googleId, rekey.toEmail])).toEqual([
      [GRACE_ROW, GRACE_GOOGLE, "ada@example.invalid"],
      [ADA_ROW, ADA_GOOGLE, "grace@example.invalid"],
    ]);
  });

  it("accepts a chain whose destination holder is itself being renamed away", () => {
    const grace: HeldPerson = { email: "ada.lovelace@example.invalid", googleId: GRACE_GOOGLE, id: GRACE_ROW };
    const plan = planGoogleIdRekeys({
      held: [adaBefore, grace],
      people: [draft(), draft({ email: "grace@example.invalid", googleId: GRACE_GOOGLE })],
    });
    expect(plan.collisions).toEqual([]);
    expect(plan.rekeys.length).toBe(2);
  });

  it("refuses, naming the person, when a row that stays put already holds the new address", () => {
    const memberOnly: HeldPerson = { email: "ada.lovelace@example.invalid", googleId: null, id: MEMBER_ROW };
    const plan = planGoogleIdRekeys({ held: [adaBefore, memberOnly], people: [draft()] });
    expect(plan.collisions).toEqual([
      {
        column: "email",
        constraint: "uq_person_email",
        emails: ["ada.lovelace@example.invalid"],
        value: "ada.lovelace@example.invalid",
        why: "google id 100000000000000000001 moved from ada@example.invalid to ada.lovelace@example.invalid, which another person row already holds — merging the two is not something the reconciler decides",
      },
    ]);
  });

  it("refuses when a row already holds the scratch address a rename passes through", () => {
    const squatter: HeldPerson = {
      email: rekeyTemporaryEmail({ googleId: ADA_GOOGLE }),
      googleId: null,
      id: MEMBER_ROW,
    };
    const plan = planGoogleIdRekeys({ held: [adaBefore, squatter], people: [draft()] });
    expect(plan.collisions.map((collision) => collision.value)).toEqual([
      "rekey-100000000000000000001@identity-rekey.invalid",
    ]);
  });

  it("refuses a draft whose own address is another rename's scratch address, before any write", () => {
    const grace: HeldPerson = { email: "grace@example.invalid", googleId: GRACE_GOOGLE, id: GRACE_ROW };
    const plan = planGoogleIdRekeys({
      held: [adaBefore, grace],
      people: [draft(), draft({ email: rekeyTemporaryEmail({ googleId: ADA_GOOGLE }), googleId: GRACE_GOOGLE })],
    });
    expect(plan.collisions.map((collision) => collision.value)).toEqual([
      "rekey-100000000000000000001@identity-rekey.invalid",
    ]);
  });

  it("refuses a draft in the scratch namespace even when no rename of this run uses it", () => {
    const plan = planGoogleIdRekeys({
      held: [],
      people: [draft({ email: rekeyTemporaryEmail({ googleId: ADA_GOOGLE }), googleId: GRACE_GOOGLE })],
    });
    expect(plan).toEqual({
      collisions: [
        {
          column: "email",
          constraint: "uq_person_email",
          emails: ["rekey-100000000000000000001@identity-rekey.invalid"],
          value: "rekey-100000000000000000001@identity-rekey.invalid",
          why: "rekey-100000000000000000001@identity-rekey.invalid sits in the reserved identity-rekey.invalid namespace a rename passes through, never a person's address",
        },
      ],
      rekeys: [],
    });
  });

  it("refuses a reissued address rather than handing a departed person's row to its new holder", () => {
    const departed: HeldPerson = { email: "shared@example.invalid", googleId: GRACE_GOOGLE, id: GRACE_ROW };
    const plan = planGoogleIdRekeys({ held: [departed], people: [draft({ email: "shared@example.invalid" })] });
    expect(plan).toEqual({
      collisions: [
        {
          column: "email",
          constraint: "uq_person_email",
          emails: ["shared@example.invalid"],
          value: "shared@example.invalid",
          why: "Google now issues shared@example.invalid to google id 100000000000000000001, but the person row holding it belongs to google id 100000000000000000002 — the email upsert would hand that person's history to someone else",
        },
      ],
      rekeys: [],
    });
  });

  it("lets a member-only row with no google id be joined by its directory draft, the ordinary first join", () => {
    const memberOnly: HeldPerson = { email: "ada.lovelace@example.invalid", googleId: null, id: MEMBER_ROW };
    expect(planGoogleIdRekeys({ held: [memberOnly], people: [draft()] })).toEqual({ collisions: [], rekeys: [] });
  });

  it("refuses a rename whose vacated address a member draft with no google id still claims, rather than splitting the person", () => {
    const plan = planGoogleIdRekeys({
      held: [adaBefore],
      people: [draft(), draft({ email: "ada@example.invalid", googleId: null })],
    });
    expect(plan.collisions).toEqual([
      {
        column: "email",
        constraint: "uq_person_email",
        emails: ["ada@example.invalid"],
        value: "ada@example.invalid",
        why: "google id 100000000000000000001 moved from ada@example.invalid to ada.lovelace@example.invalid, but a member draft with no google id still claims ada@example.invalid — renaming would split one person into two rows",
      },
    ]);
  });

  it("renames a person whose old address Google reissued to a new hire, leaving that address to the new hire's insert", () => {
    const plan = planGoogleIdRekeys({
      held: [adaBefore],
      people: [draft(), draft({ displayName: "Grace Hopper", email: "ada@example.invalid", googleId: GRACE_GOOGLE })],
    });
    expect(plan.collisions).toEqual([]);
    expect(plan.rekeys.map((rekey) => [rekey.personId, rekey.fromEmail, rekey.toEmail])).toEqual([
      [ADA_ROW, "ada@example.invalid", "ada.lovelace@example.invalid"],
    ]);
  });

  it("refuses two drafts carrying one google id, naming both", () => {
    const plan = planGoogleIdRekeys({ held: [], people: [draft(), draft({ email: "ada@example.invalid" })] });
    expect(plan).toEqual({
      collisions: [
        {
          column: "google_id",
          constraint: "uq_person_google_id",
          emails: ["ada.lovelace@example.invalid", "ada@example.invalid"],
          value: ADA_GOOGLE,
          why: "two directory drafts carry one google id",
        },
      ],
      rekeys: [],
    });
  });
});

/** The shape Drizzle throws: its own wrapper over the driver's `PostgresError`. */
function drizzleFailure({ code, constraint, detail }: { code: string; constraint: string; detail: string }): Error {
  const driver = Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code,
    constraint_name: constraint,
    detail,
  });
  return new Error('Failed query: insert into "person" … params: …', { cause: driver });
}

describe("personCollisionOf", () => {
  it("names the renamed person a google id collision belongs to", () => {
    const cause = drizzleFailure({
      code: "23505",
      constraint: "uq_person_google_id",
      detail: `Key (google_id)=(${ADA_GOOGLE}) already exists.`,
    });
    expect(
      personCollisionOf({ cause, people: [draft(), draft({ email: "grace@example.invalid", googleId: "2" })] }),
    ).toEqual({
      column: "google_id",
      constraint: "uq_person_google_id",
      emails: ["ada.lovelace@example.invalid"],
      value: ADA_GOOGLE,
    });
  });

  it("maps a platform id collision through its draft field", () => {
    const cause = drizzleFailure({
      code: "23505",
      constraint: "uq_person_slack_user_id",
      detail: "Key (slack_user_id)=(U0SYNADA00001) already exists.",
    });
    expect(personCollisionOf({ cause, people: [draft({ slackUserId: "U0SYNADA00001" })] })!.emails).toEqual([
      "ada.lovelace@example.invalid",
    ]);
  });

  it("is undefined when no draft carries the refused value, rather than naming nobody", () => {
    const cause = drizzleFailure({
      code: "23505",
      constraint: "uq_person_slack_user_id",
      detail: "Key (slack_user_id)=(U0SYNADA00001) already exists.",
    });
    expect(personCollisionOf({ cause, people: [draft()] })).toBe(undefined);
  });

  it("is undefined for a failure that is not a person unique violation", () => {
    const content = drizzleFailure({
      code: "23505",
      constraint: "uq_content_source_id",
      detail: "Key (source, source_id)=(slack, x) already exists.",
    });
    const check = drizzleFailure({ code: "23514", constraint: "person_email_shape", detail: "Failing row contains …" });
    const mismatched = drizzleFailure({
      code: "23505",
      constraint: "uq_person_google_id",
      detail: "Key (email)=(ada.lovelace@example.invalid) already exists.",
    });
    expect(personCollisionOf({ cause: content, people: [draft()] })).toBe(undefined);
    expect(personCollisionOf({ cause: check, people: [draft()] })).toBe(undefined);
    expect(personCollisionOf({ cause: mismatched, people: [draft()] })).toBe(undefined);
    expect(personCollisionOf({ cause: new Error("connect ECONNREFUSED"), people: [draft()] })).toBe(undefined);
  });

  it("terminates on a cause chain that loops", () => {
    const looped: { cause?: unknown } = {};
    looped.cause = looped;
    expect(personCollisionOf({ cause: looped, people: [draft()] })).toBe(undefined);
  });
});

describe("the error a collided run returns", () => {
  it("names the person in its message, never the statement", () => {
    const cause = drizzleFailure({
      code: "23505",
      constraint: "uq_person_google_id",
      detail: `Key (google_id)=(${ADA_GOOGLE}) already exists.`,
    });
    const error = StoreErrors.personCollided({
      cause,
      collisions: [personCollisionOf({ cause, people: [draft()] })!],
      what: "store identity reconcile",
    });
    expect(error.code).toBe("PERSON_COLLIDED");
    expect(storeErrorLines({ error })).toEqual([
      "store identity reconcile failed, writing nothing: google_id 100000000000000000001, carried by ada.lovelace@example.invalid, is already held by another person row (uq_person_google_id)",
    ]);
  });

  it("gives each of several collisions its own line", () => {
    const plan = planGoogleIdRekeys({
      held: [adaBefore, { email: "ada.lovelace@example.invalid", googleId: null, id: MEMBER_ROW }],
      people: [
        draft(),
        draft({ email: "grace@example.invalid", googleId: GRACE_GOOGLE }),
        draft({ email: "g2@example.invalid", googleId: GRACE_GOOGLE }),
      ],
    });
    const lines = storeErrorLines({
      error: StoreErrors.personCollided({ collisions: plan.collisions, what: "store identity reconcile" }),
    });
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe("2 people collided, so nothing was written:");
  });
});
