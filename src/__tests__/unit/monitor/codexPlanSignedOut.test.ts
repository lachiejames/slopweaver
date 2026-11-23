import { describe, expect, it } from "vitest";

import type { CodexSignInRecord } from "../../../codex/signInRecord.js";
import { postingRefusal } from "../../../hand/posting.js";
import { postingOrRowRefusal } from "../../../hand/postingChecks.js";
import { fleetActorPhrase, UNBLOCKS_CAP, WHAT_CAP } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";
import { buildArrival } from "../../../monitor/card.js";
import { CODEX_PLAN_SIGNED_OUT } from "../../../monitor/codexPlanSignedOutDefinition.js";
import { type CodexStoreInput, evaluateCodexPlanSignedOut } from "../../../monitor/evaluate.js";
import { monitorDefinition } from "../../../monitor/registry.js";

import { firing, unmeasurable } from "./readings.js";

const HOME_ONE = "/Users/owner/.codex-one";
const READ_ISO = "2026-09-25T12:35:00.000Z";
const STAMP = { ctimeMs: 1, kind: "present", mtimeMs: 1, size: 900 } as const;

/** A store every check passes — signed in, present, nothing filed. */
function store(over: Partial<CodexStoreInput> = {}): CodexStoreInput {
  return {
    alias: "codex-one",
    authFile: "signed-in",
    authStamp: STAMP,
    codexHome: HOME_ONE,
    email: undefined,
    pausedReason: undefined,
    record: undefined,
    recordUnreadable: undefined,
    storeExists: true,
    ...over,
  };
}

/** What the live read files for a signed-out codex-one. */
function refused(over: Partial<CodexSignInRecord> = {}): CodexSignInRecord {
  return {
    alias: "codex-one",
    authStamp: STAMP,
    codexHome: HOME_ONE,
    failingSinceIso: "2026-09-25T12:30:00.000Z",
    readAtIso: READ_ISO,
    state: "signed-out",
    ...over,
  };
}

describe("evaluateCodexPlanSignedOut", () => {
  it("is clear when every store is present and signed in, with nothing filed", () => {
    expect(evaluateCodexPlanSignedOut({ stores: [store(), store({ alias: "codex-two" })] }).state).toBe("clear");
  });

  it("fires on a signed-out codex-one state — no sign-in in its store — carrying the exact command to paste", () => {
    const reading = firing({
      reading: evaluateCodexPlanSignedOut({
        stores: [store({ authFile: "absent", authStamp: { kind: "absent" } }), store({ alias: "codex-two" })],
      }),
    });
    expect(reading.subjects).toEqual([
      {
        id: "codex-one",
        key: "codex-one",
        label: "no auth.json is in its store",
        literal: `mkdir -p ${HOME_ONE} && CODEX_HOME=${HOME_ONE} codex login`,
      },
    ]);
  });

  it("fires on a store whose directory is gone, ahead of reading its auth", () => {
    const reading = firing({ reading: evaluateCodexPlanSignedOut({ stores: [store({ storeExists: false })] }) });
    expect(reading.subjects.map((subject) => subject.label)).toEqual(["its store directory does not exist"]);
  });

  it("fires when the live read refused a store whose auth.json still looks signed in and has not changed since", () => {
    const reading = firing({ reading: evaluateCodexPlanSignedOut({ stores: [store({ record: refused() })] }) });
    expect(reading.subjects.map((subject) => subject.label)).toEqual([
      "the live read has refused its sign-in since 2026-09-25T12:30:00.000Z",
    ]);
  });

  it("clears on a sign-in made AFTER the live read refused the store — the owner's answer, which the next read re-checks", () => {
    const signedInLater = store({ authStamp: { ...STAMP, mtimeMs: 2 }, record: refused() });
    expect(evaluateCodexPlanSignedOut({ stores: [signedInLater] }).state).toBe("clear");
  });

  it("names an auth.json that does not parse apart from one that parses with no sign-in in it", () => {
    const reading = firing({
      reading: evaluateCodexPlanSignedOut({
        stores: [store({ authFile: "unreadable" }), store({ alias: "codex-two", authFile: "no-sign-in" })],
      }),
    });
    expect(reading.subjects.map((subject) => subject.label)).toEqual([
      "its auth.json does not parse",
      "its auth.json carries no sign-in",
    ]);
  });

  it("is clear on a record whose newest live read found the store signed in", () => {
    const signedIn = store({ record: refused({ failingSinceIso: undefined, state: "signed-in" }) });
    expect(evaluateCodexPlanSignedOut({ stores: [signedIn] }).state).toBe("clear");
  });

  it("ignores a record filed against a different directory, so a re-pointed alias inherits no old failure", () => {
    const repointed = store({ record: refused({ codexHome: "/Users/owner/.codex-old" }) });
    expect(evaluateCodexPlanSignedOut({ stores: [repointed] }).state).toBe("clear");
  });

  it("keeps a paused store on the card, naming the pause — the plan is still paid for", () => {
    const paused = store({ authFile: "absent", pausedReason: "no auth.json; routing sends passes elsewhere" });
    const reading = firing({ reading: evaluateCodexPlanSignedOut({ stores: [paused] }) });
    expect(reading.subjects[0]!.label).toBe(
      `no auth.json is in its store; paused meanwhile: no auth.json; routing sends passes elsewhere`,
    );
  });

  it("posts one subject per unusable store, each its own command", () => {
    const reading = firing({
      reading: evaluateCodexPlanSignedOut({
        stores: [
          store({ authFile: "absent" }),
          store({ alias: "codex-two", codexHome: "/Users/owner/.codex-two", storeExists: false }),
        ],
      }),
    });
    expect(reading.subjects.map((subject) => [subject.key, subject.literal])).toEqual([
      ["codex-one", `mkdir -p ${HOME_ONE} && CODEX_HOME=${HOME_ONE} codex login`],
      ["codex-two", "mkdir -p /Users/owner/.codex-two && CODEX_HOME=/Users/owner/.codex-two codex login"],
    ]);
  });

  it("is unmeasurable, never clear, when a record cannot be read and nothing else condemns the store", () => {
    const reading = unmeasurable({
      reading: evaluateCodexPlanSignedOut({ stores: [store({ recordUnreadable: "x.json is not a JSON object" })] }),
    });
    expect(reading.because).toBe("sign-in record unreadable — codex-one: x.json is not a JSON object");
  });

  it("still fires on another store beside an unreadable record, and names the blind spot", () => {
    const reading = firing({
      reading: evaluateCodexPlanSignedOut({
        stores: [store({ recordUnreadable: "bad" }), store({ alias: "codex-two", authFile: "absent" })],
      }),
    });
    expect([reading.subjects.map((subject) => subject.id), reading.blindSpot]).toEqual([
      ["codex-two"],
      "sign-in record unreadable — codex-one: bad",
    ]);
  });
});

describe("the codex-plan-signed-out card", () => {
  const definition = monitorDefinition({ monitorId: "codex-plan-signed-out" });
  const subject = firing({
    reading: evaluateCodexPlanSignedOut({ stores: [store({ authFile: "absent" })] }),
  }).subjects[0]!;
  const step = unwrap(
    buildArrival({
      address: { consoleBase: "http://localhost:3000", occurrence: 1 },
      definition,
      nowIso: "2026-09-28T08:00:00.000Z",
      postedBy: "workspace:29",
      subject,
    }),
  );

  it("is the declaration its own module carries, listed in its place in the registry", () => {
    expect(definition).toBe(CODEX_PLAN_SIGNED_OUT);
  });

  it("names the plan and the owner's one step, and the posting form accepts it", () => {
    expect(step.what).toBe("Sign Codex plan codex-one back in — paste the copied command into your terminal");
    expect(postingRefusal({ step })).toBeUndefined();
  });

  it("puts the exact sign-in command on the owner's pasteboard and says where it goes and how the fleet re-checks it", () => {
    expect([step.literal, step.where]).toEqual([
      `mkdir -p ${HOME_ONE} && CODEX_HOME=${HOME_ONE} codex login`,
      "Your own terminal — the card clears on the new sign-in, and returns if the next Codex read refuses it",
    ]);
  });

  it("says what failed, and how skipping it differs from falling back off a capped plan", () => {
    expect(step.unblocks).toBe(
      `codex-one: no auth.json is in its store. Codex skips it for the next signed-in plan, as for a capped one, but a cap resets itself and a sign-out never does`,
    );
  });

  it("opens its own queue item, ranks at the top by its work context, and floats as a note", () => {
    expect([step.id, step.url, step.context, definition.floats, definition.perSubject]).toEqual([
      "mon-codex-codex-one",
      "http://localhost:3000/queue?open=hand%3Amon-codex-codex-one&context=work",
      "work",
      true,
      true,
    ]);
  });

  it("fits the longest alias the register allows inside the note's cap, naming the owner as the actor", () => {
    const longest = definition.what({ subject: { ...subject, id: "a".repeat(32) } });
    expect(longest.length).toBeLessThanOrEqual(WHAT_CAP);
    expect(fleetActorPhrase({ what: longest })).toBe(undefined);
  });

  it("marks a cut in a long pause reason and keeps the answer to the owner's question whole", () => {
    const long = {
      ...subject,
      label: `no auth.json is in its store; paused meanwhile: ${"waiting on you ".repeat(20)}`,
    };
    const unblocks = definition.unblocks({ subject: long });
    expect([unblocks.length <= UNBLOCKS_CAP, unblocks.split("…")]).toEqual([
      true,
      [
        "codex-one: no auth.json is in its store; paused meanwhile: waiting on you waiting",
        " Codex skips it for the next signed-in plan, as for a capped one, but a cap resets itself and a sign-out never does",
      ],
    ]);
  });

  it("folds a pause reason's line breaks, control and format characters onto one line, U+0085 and U+202E included", () => {
    const broken = { ...subject, label: "no auth.json is in its store; paused meanwhile: waiting\u0085for\n\t‮you" };
    expect(definition.unblocks({ subject: broken })).toBe(
      "codex-one: no auth.json is in its store; paused meanwhile: waiting for you. Codex skips it for the next signed-in plan, as for a capped one, but a cap resets itself and a sign-out never does",
    );
  });

  describe("with the address the register caches", () => {
    const EMAIL = "ada-owner-codex-3@slopweaver.ai";
    const PLANS = [{ alias: "codex-three", email: EMAIL }];
    const addressed = firing({
      reading: evaluateCodexPlanSignedOut({
        stores: [store({ alias: "codex-three", authFile: "absent", email: EMAIL })],
      }),
    }).subjects[0]!;
    const card = (over: Partial<typeof addressed>) =>
      unwrap(
        buildArrival({
          address: { consoleBase: "http://localhost:3000", occurrence: 1 },
          definition,
          nowIso: "2026-09-29T14:00:00.000Z",
          postedBy: "workspace:29",
          subject: { ...addressed, ...over },
        }),
      );

    it("leads on the address, keeps the alias, and fits the longest registered pair inside the cap", () => {
      expect(card({}).what).toBe(
        "Sign in as ada-owner-codex-3@slopweaver.ai on Codex (codex-three) — paste the copied command into your terminal",
      );
    });

    it("drops the alias before the address when the cap has no room for both", () => {
      expect(definition.what({ subject: { ...addressed, id: "a".repeat(32) } })).toBe(
        "Sign in as ada-owner-codex-3@slopweaver.ai on Codex — paste the copied command into your terminal",
      );
    });

    it("passes the register's lock-held posting check, which refuses the alias-only sentence it replaces", () => {
      const check = (posted: ReturnType<typeof card>) =>
        postingOrRowRefusal({ plans: PLANS, replacing: undefined, rows: [], step: posted, unparsed: [] });
      expect([check(card({})).isOk(), check(card({ email: undefined }))._unsafeUnwrapErr().message]).toEqual([
        true,
        "what asks the owner to sign into codex-three without its email address — add ada-owner-codex-3@slopweaver.ai. " +
          "The owner signs in with the address, and a plan number alone makes them guess which account it is",
      ]);
    });
  });

  it("never names the store path on the card's what or unblocks — the pasted command carries it whole", () => {
    expect([step.what.includes(HOME_ONE), step.unblocks.includes(HOME_ONE), step.literal!.includes(HOME_ONE)]).toEqual([
      false,
      false,
      true,
    ]);
  });
});
