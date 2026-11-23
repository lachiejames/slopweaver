/**
 * Publishing a KnowBe4 sync: an answered path replaces its kind, a failed one carries the kind's earlier
 * entities and success forward, a 403 is stamped as the subscription tier's block, and the read adapter serves
 * what was published. Every store write goes to a `mkdtempSync` home.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { KNOWBE4_FILL_CALLS, SUBSCRIPTION_UNBLOCKED_BY } from "../../../../atlas/knowbe4/fill/plan.js";
import { projectAccount, projectUsers } from "../../../../atlas/knowbe4/fill/project.js";
import type { Knowbe4ProjectedItem } from "../../../../atlas/knowbe4/fill/projectShapes.js";
import type { Knowbe4CallFailed, Knowbe4FillObservation } from "../../../../atlas/knowbe4/fill/run.js";
import { readKnowbe4Snapshot } from "../../../../atlas/knowbe4/readAdapter.js";
import { knowbe4AtlasPaths, readKnowbe4Atlas } from "../../../../atlas/knowbe4/store.js";
import { syncKnowbe4Atlas } from "../../../../atlas/knowbe4/sync.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { copyHomeInto } from "../homeTemplate.js";

const FIRST = "2026-10-15T00:00:00.000Z";
const SECOND = "2026-10-16T00:00:00.000Z";

// Built by the real projector: a sync publishes no detail object a projector did not build.
const USERS: readonly Knowbe4ProjectedItem[] = unwrap(
  projectUsers({
    body: [
      { email: "b@example.com", id: 2 },
      { email: "a@example.com", id: 1 },
    ],
    parentId: null,
  }),
).items;

let home: string;

/**
 * A home holding the first full read at FIRST, published ONCE and copied into each case that starts from it
 * rather than re-published per case (`homeTemplate.ts` says why). Nothing writes into it.
 */
let firstRead: string;

beforeAll(() => {
  firstRead = mkdtempSync(join(tmpdir(), "slopweaver-knowbe4-first-read-"));
  unwrap(syncKnowbe4Atlas({ fill: observation({ at: FIRST, failed: [] }), home: firstRead }));
});

afterAll(() => {
  rmSync(firstRead, { force: true, recursive: true });
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-knowbe4-sync-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * An observation in which every planned path answered — users with `USERS`, every other path empty — except
 * the paths `failed` names.
 *
 * @param at the run's instant
 * @param failed the paths that failed instead of answering
 * @returns the observation
 */
function observation({ at, failed }: { at: string; failed: readonly Knowbe4CallFailed[] }): Knowbe4FillObservation {
  const failedTemplates = new Set(failed.map((entry) => entry.template));
  return {
    answered: KNOWBE4_FILL_CALLS.filter((call) => !failedTemplates.has(call.template)).map((call) => ({
      items: call.template === "/v1/users" ? USERS : [],
      kind: call.kind,
      template: call.template,
      truncatedBy: null,
    })),
    failed,
    filledAtIso: at,
  };
}

const USERS_403: Knowbe4CallFailed = {
  kind: "user",
  message: "KnowBe4 answered 403 on /v1/users",
  status: 403,
  template: "/v1/users",
};

describe("syncKnowbe4Atlas", () => {
  it("publishes every kind on a first full read, users sorted by provider id", () => {
    const report = unwrap(syncKnowbe4Atlas({ fill: observation({ at: FIRST, failed: [] }), home }));
    expect(report.entitiesByKind.find((entry) => entry.kind === "user")!.entities).toBe(2);

    const snapshot = unwrap(readKnowbe4Atlas({ paths: knowbe4AtlasPaths({ home }) }));
    expect(snapshot.files.user!.entities.map((entity) => entity.providerId)).toEqual(["1", "2"]);
    expect(snapshot.manifest!.kinds.user.lastSuccessAt).toBe(FIRST);
  });

  it("declares callback phishing unread on both phishing-test kinds, and on no other kind", () => {
    copyHomeInto({ into: home, template: firstRead });

    const files = unwrap(readKnowbe4Atlas({ paths: knowbe4AtlasPaths({ home }) })).files;
    expect(
      (["phishing-security-test", "phishing-recipient", "user"] as const).map((kind) =>
        files[kind]!.coverage.map((cell) => [cell.scope, cell.state]),
      ),
    ).toEqual([
      [
        ["/v1/phishing/security_tests", "synced"],
        ["/v1/phishing/security_tests?campaign_type=callback", "excluded"],
      ],
      [
        ["/v1/phishing/security_tests/{id}/recipients", "synced"],
        ["/v1/phishing/security_tests/{id}/recipients?campaign_type=callback", "excluded"],
      ],
      [["/v1/users", "synced"]],
    ]);
  });

  it("carries a 403'd kind's earlier entities and success forward, and names the tier that would lift it", () => {
    copyHomeInto({ into: home, template: firstRead });
    unwrap(syncKnowbe4Atlas({ fill: observation({ at: SECOND, failed: [USERS_403] }), home }));

    const snapshot = unwrap(readKnowbe4Atlas({ paths: knowbe4AtlasPaths({ home }) }));
    const status = snapshot.manifest!.kinds.user;
    expect(snapshot.files.user!.entities.map((entity) => [entity.providerId, entity.channels.api!.lastSeenAt])).toEqual(
      [
        ["1", FIRST],
        ["2", FIRST],
      ],
    );
    expect([status.lastSuccessAt, status.lastAttempt!.outcome, status.permissionBlocked!.unblockedBy]).toEqual([
      FIRST,
      "failed",
      SUBSCRIPTION_UNBLOCKED_BY,
    ]);
    expect(status.lastAttempt!.reasons).toEqual(["/v1/users answered 403 — KnowBe4 answered 403 on /v1/users"]);
  });

  it("keeps the last whole read exactly as it was when a later read stops at a bound", () => {
    copyHomeInto({ into: home, template: firstRead });
    const bounded = observation({ at: SECOND, failed: [] });
    const added = unwrap(projectUsers({ body: [{ email: "c@example.com", id: 3 }], parentId: null })).items;
    const fill: Knowbe4FillObservation = {
      ...bounded,
      answered: bounded.answered.map((entry) =>
        entry.template === "/v1/users"
          ? { ...entry, items: [USERS[1]!, ...added], truncatedBy: "the 20-page bound" }
          : entry,
      ),
    };
    unwrap(syncKnowbe4Atlas({ fill, home }));

    const snapshot = unwrap(readKnowbe4Atlas({ paths: knowbe4AtlasPaths({ home }) }));
    const users = snapshot.files.user!;
    // User 1 WAS reached this run and user 3 is new, yet the file is the kind exactly as of FIRST, never a mix (p3).
    expect(users.entities.map((entity) => [entity.providerId, entity.channels.api!.lastSeenAt])).toEqual([
      ["1", FIRST],
      ["2", FIRST],
    ]);
    // The cell keeps FIRST's success and marks SECOND's bounded attempt failed, never a fresh success.
    expect([
      users.coverage[0]!.state,
      users.coverage[0]!.lastSuccessAt,
      users.coverage[0]!.latestAttemptFailed,
    ]).toEqual(["deferred", FIRST, true]);
    const status = snapshot.manifest!.kinds.user;
    expect([status.lastSuccessAt, status.lastAttempt!.outcome, status.lastAttempt!.reasons]).toEqual([
      FIRST,
      "failed",
      ["/v1/users stopped at the 20-page bound"],
    ]);
  });

  it("publishes a first read that stopped at a bound, with no success claimed for the bounded kind", () => {
    const bounded = observation({ at: FIRST, failed: [] });
    const fill: Knowbe4FillObservation = {
      ...bounded,
      answered: bounded.answered.map((entry) =>
        entry.template === "/v1/users" ? { ...entry, truncatedBy: "the 20-page bound" } : entry,
      ),
    };
    unwrap(syncKnowbe4Atlas({ fill, home }));

    const snapshot = unwrap(readKnowbe4Atlas({ paths: knowbe4AtlasPaths({ home }) }));
    expect(snapshot.files.user!.entities.map((entity) => entity.providerId)).toEqual(["1", "2"]);
    expect([snapshot.manifest!.kinds.user.lastSuccessAt, snapshot.manifest!.kinds.group.lastSuccessAt]).toEqual([
      null,
      FIRST,
    ]);
  });

  it("drops an entity a COMPLETE read no longer lists", () => {
    copyHomeInto({ into: home, template: firstRead });
    const complete = observation({ at: SECOND, failed: [] });
    const fill: Knowbe4FillObservation = {
      ...complete,
      answered: complete.answered.map((entry) =>
        entry.template === "/v1/users" ? { ...entry, items: [USERS[1]!] } : entry,
      ),
    };
    unwrap(syncKnowbe4Atlas({ fill, home }));

    const users = unwrap(readKnowbe4Atlas({ paths: knowbe4AtlasPaths({ home }) })).files.user!;
    expect(users.entities.map((entity) => entity.providerId)).toEqual(["1"]);
  });

  it("refuses a hand-built item carrying a field no projector keeps, and writes nothing", () => {
    const forged = observation({ at: FIRST, failed: [] });
    const fill: Knowbe4FillObservation = {
      ...forged,
      answered: forged.answered.map((entry) =>
        entry.template === "/v1/users"
          ? { ...entry, items: [{ detail: { family: "/v1/users", phone_number: "fake-phone" }, providerId: "1" }] }
          : entry,
      ),
    };

    const refused = unwrapErr(syncKnowbe4Atlas({ fill, home }));

    expect(refused).toEqual([
      "refused to publish 1 KnowBe4 item(s) their path's projector did not build, first /v1/users 1",
    ]);
    expect(readdirSync(home)).toEqual([]);
  });

  it("refuses a REAL projected detail filed under another path, which would carry that path's fields across", () => {
    const account = unwrap(
      projectAccount({ body: { name: "Example Co", subscription_level: "Diamond" }, parentId: null }),
    ).items[0]!;
    const forged = observation({ at: FIRST, failed: [] });
    const fill: Knowbe4FillObservation = {
      ...forged,
      answered: forged.answered.map((entry) =>
        entry.template === "/v1/users" ? { ...entry, items: [{ detail: account.detail, providerId: "1" }] } : entry,
      ),
    };

    expect(unwrapErr(syncKnowbe4Atlas({ fill, home }))).toEqual([
      "refused to publish 1 KnowBe4 item(s) their path's projector did not build, first /v1/users 1",
    ]);
    expect(readdirSync(home)).toEqual([]);
  });

  it("refuses to let a field be added to a projected detail after the projector built it", () => {
    const item = unwrap(projectUsers({ body: [{ email: "c@example.com", id: 3 }], parentId: null })).items[0]!;

    expect(() => Object.assign(item.detail, { phone_number: "fake-phone" })).toThrow(TypeError);
    expect(Object.keys(item.detail)).not.toContain("phone_number");
  });

  it("keeps the first time an entity was seen across a later successful read", () => {
    copyHomeInto({ into: home, template: firstRead });
    unwrap(syncKnowbe4Atlas({ fill: observation({ at: SECOND, failed: [] }), home }));

    const entity = unwrap(readKnowbe4Atlas({ paths: knowbe4AtlasPaths({ home }) })).files.user!.entities[0]!;
    expect([entity.channels.api!.firstSeenAt, entity.channels.api!.lastSeenAt]).toEqual([FIRST, SECOND]);
  });
});

describe("readKnowbe4Snapshot", () => {
  it("refuses an unpublished home with the hand step and the sync verb as the remedy", () => {
    const refused = unwrapErr(readKnowbe4Snapshot({ home }));
    expect(refused.message).toContain("slopweaver secrets set knowbe4-api-token");
    expect(refused.message).toContain("`slopweaver atlas knowbe4 sync` reads it and publishes");
  });

  it("serves what a sync published, its api observations named for the Reporting API surface", () => {
    copyHomeInto({ into: home, template: firstRead });
    const users = unwrap(readKnowbe4Snapshot({ home })).kinds.find((kind) => kind.kind === "user")!;
    expect(users.entities.map((entity) => entity.observations.map((observed) => observed.surface))).toEqual([
      ["reporting-api-v1"],
      ["reporting-api-v1"],
    ]);
  });
});
