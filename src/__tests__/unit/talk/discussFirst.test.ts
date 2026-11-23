/*
 * The discuss-first nudge as `talk relay` carries it: the record out of its four flags, and the clause the row and
 * the chair's line open on. The owner's ruling is that the voice asks whether the team discussed a fix first, and
 * that an explicit request from the owner overrides that question.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DISCUSS_FIRST_QUESTION,
  discussFirstLead,
  discussFirstRecordOf,
  discussFirstStandingOf,
  joinedLead,
  type PriorPutRead,
  teamFixRefusal,
} from "../../../talk/discussFirst.js";
import { STILL_SPEAKING_HOLD } from "../../../talk/relayCutHold.js";
import { ACME_ORGANISATION, FIXTURE_SELF_REPOSITORY, GLOBEX_ORGANISATION } from "../../organisationFixture.js";

const TURN = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const THREAD = "https://acme.slack.com/archives/C0SYN000001/p1791351441819519";

describe("discussFirstRecordOf", () => {
  it("reads no record from no flag, a put with its thread, and an override naming the relay that put it", () => {
    expect([
      discussFirstRecordOf({ priorTurn: undefined, repository: undefined, status: undefined, thread: undefined }),
      discussFirstRecordOf({
        priorTurn: undefined,
        repository: "acme/acme-admin",
        status: "put",
        thread: THREAD,
      }),
      discussFirstRecordOf({
        priorTurn: TURN,
        repository: "acme/acme-admin",
        status: "override",
        thread: undefined,
      }),
    ]).toEqual([
      { record: undefined },
      { record: { repository: "acme/acme-admin", status: "put", thread: THREAD } },
      { record: { priorTurnId: TURN, repository: "acme/acme-admin", status: "override", thread: undefined } },
    ]);
  });

  it("refuses an over-long thread and an override turn that is not the page's v4 UUID", () => {
    expect([
      discussFirstRecordOf({
        priorTurn: undefined,
        repository: "acme/acme-admin",
        status: "put",
        thread: `${THREAD}?${"x".repeat(200)}`,
      }),
      discussFirstRecordOf({
        priorTurn: "turn-1",
        repository: "acme/acme-admin",
        status: "override",
        thread: undefined,
      }),
    ]).toEqual([
      { problems: ["--fix-thread must be a Slack message link of at most 200 characters"] },
      { problems: ["--discuss-first override needs --discuss-first-turn <uuid>: the relay that put the question"] },
    ]);
  });

  // The verb admits exactly the links the page does, a reply's query included.
  it("reads a reply's link with its thread_ts, and refuses a link with a path past the message", () => {
    const reply = `${THREAD}?thread_ts=1791351400.000100&cid=C0SYN000001`;
    const at = ({ thread }: { thread: string }) =>
      discussFirstRecordOf({ priorTurn: undefined, repository: "acme/acme-admin", status: "put", thread });
    const refused = { problems: ["--fix-thread must be a Slack message link of at most 200 characters"] };
    expect([at({ thread: reply }), at({ thread: `${THREAD}/extra` }), at({ thread: `${THREAD}?not a query` })]).toEqual(
      [{ record: { repository: "acme/acme-admin", status: "put", thread: reply } }, refused, refused],
    );
  });

  // The page admits a v4 UUID in either case, so the verb must too.
  it("reads an override naming an upper-case v4 UUID, as the page admits one", () => {
    const upper = TURN.toUpperCase();
    expect(
      discussFirstRecordOf({
        priorTurn: upper,
        repository: "acme/acme-admin",
        status: "override",
        thread: undefined,
      }),
    ).toEqual({
      record: { priorTurnId: upper, repository: "acme/acme-admin", status: "override", thread: undefined },
    });
  });

  it("names every problem at once: a stray flag, an unknown status, a clone-address repository, a turn on a put", () => {
    expect([
      discussFirstRecordOf({
        priorTurn: undefined,
        repository: "acme/acme-admin",
        status: undefined,
        thread: undefined,
      }),
      discussFirstRecordOf({
        priorTurn: undefined,
        repository: "Acme/acme-admin",
        status: "maybe",
        thread: undefined,
      }),
      discussFirstRecordOf({ priorTurn: TURN, repository: "acme/acme-admin.git", status: "put", thread: undefined }),
      discussFirstRecordOf({
        priorTurn: undefined,
        repository: "acme/acme-admin.git.git",
        status: "put",
        thread: undefined,
      }),
    ]).toEqual([
      { problems: ["--team-fix, --fix-thread and --discuss-first-turn go only with --discuss-first put|override"] },
      {
        problems: [
          "--discuss-first must be put or override, got maybe",
          "--discuss-first needs --team-fix <owner/repo>: a team repository, lower-case, never Slopweaver's own",
        ],
      },
      {
        problems: [
          "--discuss-first needs --team-fix <owner/repo>: a team repository, lower-case, never Slopweaver's own",
          "--discuss-first-turn goes only with --discuss-first override",
        ],
      },
      {
        problems: [
          "--discuss-first needs --team-fix <owner/repo>: a team repository, lower-case, never Slopweaver's own",
        ],
      },
    ]);
  });
});

const PUT = { repository: "acme/acme-admin", status: "put", thread: THREAD } as const;
const OVERRIDE = { ...PUT, priorTurnId: TURN, status: "override" } as const;

describe("teamFixRefusal", () => {
  it("lets a team repository stand, and refuses Slopweaver's own or one outside the organisation by name", () => {
    expect([
      teamFixRefusal({ organisation: ACME_ORGANISATION, record: PUT }),
      teamFixRefusal({ organisation: ACME_ORGANISATION, record: { ...PUT, repository: FIXTURE_SELF_REPOSITORY } }),
      teamFixRefusal({ organisation: ACME_ORGANISATION, record: { ...PUT, repository: "octocat/hello-world" } }),
    ]).toEqual([
      undefined,
      `--team-fix ${FIXTURE_SELF_REPOSITORY} is not a team repository of Acme: never Slopweaver's own, never one outside the organisation`,
      "--team-fix octocat/hello-world is not a team repository of Acme: never Slopweaver's own, never one outside the organisation",
    ]);
  });

  it("reads the team off the organisation passed in, so another organisation refuses Acme's repository", () => {
    expect([
      teamFixRefusal({ organisation: GLOBEX_ORGANISATION, record: PUT }),
      teamFixRefusal({ organisation: GLOBEX_ORGANISATION, record: { ...PUT, repository: "globex/web" } }),
    ]).toEqual([
      "--team-fix acme/acme-admin is not a team repository of Globex: never Slopweaver's own, never one outside the organisation",
      undefined,
    ]);
  });
});

describe("discussFirstStandingOf", () => {
  const standingWith = ({ prior, hold }: { prior: PriorPutRead; hold?: string }) =>
    discussFirstStandingOf({ hold, readPrior: () => prior, record: OVERRIDE });

  it("holds a put without reading anything, and stands an answer whose turn put the question for that repository", () => {
    expect([
      discussFirstStandingOf({
        hold: undefined,
        readPrior: () => {
          throw new Error("a put reads no prior turn");
        },
        record: PUT,
      }),
      standingWith({ prior: { discussFirst: PUT, kind: "read" } }),
    ]).toEqual([
      { kind: "held", record: PUT },
      { kind: "answered", record: OVERRIDE },
    ]);
  });

  // A marker naming any well-formed turn id must not read as an answer.
  it("never stands an answer whose turn is not on record, put no question, or asked about another repository", () => {
    expect([
      standingWith({ prior: { kind: "unreadable" } }),
      standingWith({ prior: { discussFirst: null, kind: "read" } }),
      standingWith({ prior: { discussFirst: undefined, kind: "read" } }),
      standingWith({ prior: { discussFirst: OVERRIDE, kind: "read" } }),
      standingWith({ prior: { discussFirst: { ...PUT, repository: "acme/acme-web" }, kind: "read" } }),
    ]).toEqual([
      { kind: "unverified", record: OVERRIDE, why: "is not on record" },
      { kind: "unverified", record: OVERRIDE, why: "put no such question" },
      { kind: "unverified", record: OVERRIDE, why: "put no such question" },
      { kind: "unverified", record: OVERRIDE, why: "put no such question" },
      { kind: "unverified", record: OVERRIDE, why: "asked it about acme/acme-web" },
    ]);
  });

  // An answer relayed before the owner finished must not stand as a go-ahead, since a "no, wait" may follow.
  it("holds an answer that checks out when its relay is held, and leaves an unchecked one unverified", () => {
    const put: PriorPutRead = { discussFirst: PUT, kind: "read" };
    expect([
      standingWith({ hold: STILL_SPEAKING_HOLD, prior: put }),
      standingWith({ hold: STILL_SPEAKING_HOLD, prior: { kind: "unreadable" } }),
    ]).toEqual([
      { kind: "cut", record: OVERRIDE, why: STILL_SPEAKING_HOLD },
      { kind: "unverified", record: OVERRIDE, why: "is not on record" },
    ]);
  });
});

describe("discussFirstLead", () => {
  it("holds the fix on the row and the chair's line until the owner answers, the link whole on the row only", () => {
    const held = { kind: "held", record: PUT } as const;
    expect([
      discussFirstLead({ linked: true, standing: held }),
      discussFirstLead({ linked: false, standing: held }),
    ]).toEqual([
      "DISCUSS-FIRST HOLD: the voice asked the owner whether the team discussed this first — start no fix until their " +
        `answer · fix to acme/acme-admin · thread ${THREAD}`,
      "DISCUSS-FIRST HOLD: the voice asked the owner whether the team discussed this first — start no fix until their " +
        "answer · fix to acme/acme-admin · thread on the row",
    ]);
  });

  it("reads the owner's next words as their answer, and a go-ahead as standing", () => {
    const answered = { kind: "answered", record: { ...OVERRIDE, thread: undefined } } as const;
    expect(discussFirstLead({ linked: false, standing: answered })).toBe(
      "DISCUSS-FIRST ANSWER: the owner's words here answer whether the team discussed this first, and a go-ahead stands " +
        `(talk:${TURN}) · fix to acme/acme-admin`,
    );
  });

  it("holds an answer it could not check, saying which turn and why", () => {
    const unverified = {
      kind: "unverified",
      record: { ...OVERRIDE, thread: undefined },
      why: "is not on record",
    } as const;
    expect(discussFirstLead({ linked: false, standing: unverified })).toBe(
      "DISCUSS-FIRST HOLD: start no fix until the owner answers whether the team discussed this first — this relay claims " +
        `to answer it, but talk:${TURN} is not on record · fix to acme/acme-admin`,
    );
  });

  it("holds a checked answer whose relay was held, naming the turn and the reason, and stands no go-ahead", () => {
    const cut = { kind: "cut", record: { ...OVERRIDE, thread: undefined }, why: STILL_SPEAKING_HOLD } as const;
    expect(discussFirstLead({ linked: false, standing: cut })).toBe(
      "DISCUSS-FIRST HOLD: start no fix yet — this relay answers whether the team discussed this first " +
        `(talk:${TURN}), but ${STILL_SPEAKING_HOLD} · fix to acme/acme-admin`,
    );
  });

  // The chair's line cuts its lead at 240 characters (`supervisorDelivery.ts`): what to do must survive the cut.
  it("says what to do inside the 240-character lead cut, whatever the repository's name", () => {
    const repository = `acme/${"r".repeat(100)}`;
    const long = { ...OVERRIDE, repository };
    const cut = [
      discussFirstLead({ linked: false, standing: { kind: "held", record: { ...PUT, repository } } }),
      discussFirstLead({ linked: false, standing: { kind: "answered", record: long } }),
      discussFirstLead({ linked: false, standing: { kind: "unverified", record: long, why: "put no such question" } }),
    ].map((clause) => clause!.slice(0, 240));
    expect([
      cut[0]!.includes("start no fix until their answer"),
      cut[1]!.includes(`a go-ahead stands (talk:${TURN})`),
      cut[2]!.startsWith("DISCUSS-FIRST HOLD: start no fix until the owner answers"),
    ]).toEqual([true, true, true]);
  });
});

describe("joinedLead", () => {
  it("puts the discuss-first clause first, and passes either alone through", () => {
    expect([
      joinedLead({ first: "HOLD", second: "the thread says X" }),
      joinedLead({ first: "HOLD", second: undefined }),
      joinedLead({ first: "HOLD", second: "" }),
      joinedLead({ first: undefined, second: "the thread says X" }),
      joinedLead({ first: undefined, second: undefined }),
    ]).toEqual(["HOLD — the thread says X", "HOLD", "HOLD", "the thread says X", undefined]);
  });
});

// The voice says it, the chair asks it: one sentence, the owner's, in three places that cannot drift apart.
describe("the discuss-first question in canon", () => {
  it("is the same sentence on the page and in the chair's routing procedure, which exempts Slopweaver", () => {
    const page = readFileSync(new URL("../../../../site/lib/discussFirst.ts", import.meta.url), "utf8");
    const routing = readFileSync(
      new URL("../../../../skills/supervisor/reference/routing.md", import.meta.url),
      "utf8",
    );
    expect(page).toContain("export const DISCUSS_FIRST_QUESTION =");
    expect(page).toContain(`"${DISCUSS_FIRST_QUESTION}";`);
    expect(routing).toContain(DISCUSS_FIRST_QUESTION);
    expect(routing).toContain("never for a fix to Slopweaver's own repository");
  });
});
