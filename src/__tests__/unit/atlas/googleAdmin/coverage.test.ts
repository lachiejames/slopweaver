/**
 * Unit: the Google Admin atlas's four coverage graders — which state each channel earns for one kind, what
 * its reason says, and that a failed or unattempted channel carries a prior success forward.
 */
import { describe, expect, it } from "vitest";

import {
  googleAdminApiCoverageCell,
  googleAdminDiscoveryCoverageCell,
  googleAdminUnconfiguredCoverageCell,
  googleAdminUnreachedCoverageCell,
  googleAdminWalkedCoverageCell,
} from "../../../../atlas/googleAdmin/coverage.js";
import type { GoogleAdminCoverageCell } from "../../../../atlas/googleAdmin/model.js";

const EARLIER = "2026-10-01T00:00:00.000Z";
const AT = "2026-10-02T00:00:00.000Z";

/** The `admin-api` channel's remedy, verbatim. */
const API_REMEDY =
  "run `slopweaver atlas google-admin connect` under an account holding a Workspace admin role, then `slopweaver atlas google-admin fill` — the consent requests readonly administrator scopes only, and the five Cloud APIs it reads must also be enabled on the project or every operation answers 403 about the SERVICE rather than about the scope";

/** The `admin-console` channel's remedy, verbatim. */
const CONSOLE_REMEDY =
  "complete Google's step-up reauthentication for admin.google.com once in the work Chrome profile, then run: slopweaver atlas google-admin walk — the profile is signed in and the challenge is the console's own, so nothing here can pass it on the owner's behalf";

/** One artifact a prior success carried, so a failure can be shown keeping it. */
const ARTIFACT = {
  byteLength: 12,
  kind: "api-json",
  mediaType: "application/json",
  relativePath: "artifacts/directory-users.json",
  sha256: "a".repeat(64),
} as const;

/** A synced `admin-api` cell stamped at {@link EARLIER}, carrying {@link ARTIFACT}. */
function priorApiSuccess(): GoogleAdminCoverageCell {
  const cell = googleAdminApiCoverageCell({
    aggregate: false,
    at: EARLIER,
    failures: [],
    kind: "directory-users",
    operations: 1,
    previous: null,
    records: 2,
    truncated: false,
  });
  return { ...cell, artifacts: [ARTIFACT] };
}

/** A walked `admin-console` cell stamped at {@link EARLIER}, carrying {@link ARTIFACT}. */
function priorConsoleSuccess(): GoogleAdminCoverageCell {
  return {
    ...googleAdminWalkedCoverageCell({ at: EARLIER, observed: 4, opened: 2, previous: null }),
    artifacts: [ARTIFACT],
  };
}

/** A successful `admin-api` read of one kind with the two partial flags chosen by the caller. */
function apiRead({ truncated, aggregate }: { truncated: boolean; aggregate: boolean }): GoogleAdminCoverageCell {
  return googleAdminApiCoverageCell({
    aggregate,
    at: AT,
    failures: [],
    kind: "directory-users",
    operations: 3,
    previous: null,
    records: 40,
    truncated,
  });
}

describe("googleAdminDiscoveryCoverageCell", () => {
  it("grades a kind no published method declares synced, and says why it exists at all", () => {
    expect(googleAdminDiscoveryCoverageCell({ at: AT, kind: "page", operations: 0 })).toStrictEqual({
      artifacts: [],
      channel: "discovery",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "no published method declares page — it is declared so a channel that finds one has somewhere to land it",
      role: "authoritative",
      scope: "google-admin",
      state: "synced",
      surface: "discovery",
      unblockedBy: null,
      visibilityScope: "published-documents",
    });
  });

  it("quotes the method count and says it grades the map, never the account's records", () => {
    const cell = googleAdminDiscoveryCoverageCell({ at: AT, kind: "directory-users", operations: 11 });
    expect(cell.state).toBe("synced");
    expect(cell.reason).toBe(
      "Google's eleven pinned discovery documents declare 11 method(s) for directory-users, and its record shape was read from their own schemas; this grades the MAP, never this Workspace account's records",
    );
  });
});

describe("googleAdminUnconfiguredCoverageCell", () => {
  it("keeps a prior admin-api success while marking the channel not-configured, with the consent remedy", () => {
    const cell = googleAdminUnconfiguredCoverageCell({
      at: AT,
      channel: "admin-api",
      kind: "directory-users",
      previous: priorApiSuccess(),
    });
    expect(cell.lastSuccessAt).toBe(EARLIER);
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.state).toBe("not-configured");
    expect(cell.channel).toBe("admin-api");
    expect(cell.visibilityScope).toBe("granted-admin-scopes");
    expect(cell.reason).toBe("no Admin API fill ran in this sync, so no method was called for this kind");
    expect(cell.unblockedBy).toBe(API_REMEDY);
  });

  it("keeps a prior admin-console success while marking the channel not-configured, with the step-up remedy", () => {
    const cell = googleAdminUnconfiguredCoverageCell({
      at: AT,
      channel: "admin-console",
      kind: "page",
      previous: priorConsoleSuccess(),
    });
    expect(cell.lastSuccessAt).toBe(EARLIER);
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.state).toBe("not-configured");
    expect(cell.channel).toBe("admin-console");
    expect(cell.visibilityScope).toBe("console-admin-roles");
    expect(cell.reason).toBe(
      "no Admin console walk ran in this sync — the console answers this profile with Google's own step-up reauthentication until it is completed",
    );
    expect(cell.unblockedBy).toBe(CONSOLE_REMEDY);
  });

  it("says a walk reads only pages on a non-page kind, rather than that no walk ran", () => {
    const cell = googleAdminUnconfiguredCoverageCell({
      at: AT,
      channel: "admin-console",
      kind: "directory-users",
      previous: null,
    });
    expect(cell.state).toBe("not-configured");
    expect(cell.reason).toBe(
      "an Admin console walk reads only the page kind, so nothing in this sync read this kind through the console",
    );
    expect(cell.unblockedBy).toBe(null);
  });

  it("stamps no success at all on a channel never touched", () => {
    const cell = googleAdminUnconfiguredCoverageCell({
      at: AT,
      channel: "admin-api",
      kind: "directory-users",
      previous: null,
    });
    expect(cell.lastSuccessAt).toBe(null);
    expect(cell.artifacts).toStrictEqual([]);
    expect(cell.latestAttemptFailed).toBe(true);
  });
});

describe("googleAdminUnreachedCoverageCell", () => {
  it("quotes every exclusion the fill recorded, and keeps the prior success", () => {
    const cell = googleAdminUnreachedCoverageCell({
      excluded: [
        "directory.asps.list (path-needs-a-record) — needs userKey",
        "directory.asps.get (path-needs-a-record) — needs userKey",
      ],
      previous: priorApiSuccess(),
    });
    expect(cell.state).toBe("not-configured");
    expect(cell.channel).toBe("admin-api");
    expect(cell.lastSuccessAt).toBe(EARLIER);
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.reason).toBe(
      "a fill ran in this sync and called no Admin API method for this kind — it excluded 2: directory.asps.list (path-needs-a-record) — needs userKey; directory.asps.get (path-needs-a-record) — needs userKey",
    );
    expect(cell.unblockedBy).toBe(
      "read each exclusion above: scope-not-granted is fixed by `slopweaver atlas google-admin connect` under a grant that carries the scope, and a method that needs a record cannot be called until that record has been read",
    );
  });

  it("says no method the fill calls reaches the kind, with no remedy, when it excluded nothing", () => {
    const cell = googleAdminUnreachedCoverageCell({ excluded: [], previous: null });
    expect(cell.reason).toBe(
      "a fill ran in this sync and planned no Admin API method for this kind — no published read method the fill calls reaches it, so no grant or later fill can fill it",
    );
    expect(cell.unblockedBy).toBe(null);
    expect(cell.lastSuccessAt).toBe(null);
  });
});

describe("googleAdminWalkedCoverageCell", () => {
  it("grades a walk deferred, stamped with the walk's instant, quoting both counts", () => {
    const cell = googleAdminWalkedCoverageCell({ at: EARLIER, observed: 4, opened: 2, previous: null });
    expect(cell.state).toBe("deferred");
    expect(cell.channel).toBe("admin-console");
    expect(cell.lastSuccessAt).toBe(EARLIER);
    expect(cell.latestAttemptFailed).toBe(false);
    expect(cell.visibilityScope).toBe("console-admin-roles");
    expect(cell.reason).toBe(
      "a walk in the owner's own Chrome opened 2 console page(s) and judged each loaded, and saw 4 distinct route(s) linked from them. It is `deferred` rather than `synced` for two reasons neither of which more walking fixes — Google publishes no route inventory, so the denominator is what the console itself linked, and no page carries a screenshot because that route returns an image to the model rather than a file",
    );
  });

  it("grades a walk that opened no page unreadable and keeps the prior walk's success and artifacts", () => {
    const cell = googleAdminWalkedCoverageCell({ at: AT, observed: 3, opened: 0, previous: priorConsoleSuccess() });
    expect(cell.state).toBe("unreadable");
    expect(cell.channel).toBe("admin-console");
    expect(cell.lastSuccessAt).toBe(EARLIER);
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.reason).toBe(
      "a walk ran and opened no console page it could judge loaded, though it saw 3 distinct route(s) linked, so it read nothing this time",
    );
    expect(cell.unblockedBy).toBe(CONSOLE_REMEDY);
  });

  it("stamps no success on a walk that opened no page when none came before", () => {
    const cell = googleAdminWalkedCoverageCell({ at: AT, observed: 0, opened: 0, previous: null });
    expect(cell.state).toBe("unreadable");
    expect(cell.lastSuccessAt).toBe(null);
    expect(cell.artifacts).toStrictEqual([]);
  });
});

describe("googleAdminApiCoverageCell when Google refused", () => {
  const failures = ["directory.users.list answered 403 — Admin SDK API has not been used in project 1"];

  it("grades the kind unreadable and quotes every refusal, with nothing to carry when nothing came before", () => {
    const cell = googleAdminApiCoverageCell({
      aggregate: false,
      at: AT,
      failures,
      kind: "directory-users",
      operations: 0,
      previous: null,
      records: 0,
      truncated: false,
    });
    expect(cell.state).toBe("unreadable");
    expect(cell.reason).toBe(
      "the Admin API refused 1 of the operation(s) reaching this kind — directory.users.list answered 403 — Admin SDK API has not been used in project 1",
    );
    expect(cell.lastSuccessAt).toBe(null);
    expect(cell.artifacts).toStrictEqual([]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.unblockedBy).toBe(
      "read the status above: a 403 naming a SERVICE means enable that API in the Cloud project, and a 403 naming a scope or a role means the grant or the account cannot reach it",
    );
  });

  it("carries the prior success and its artifacts forward rather than erasing them", () => {
    const cell = googleAdminApiCoverageCell({
      aggregate: false,
      at: AT,
      failures,
      kind: "directory-users",
      operations: 0,
      previous: priorApiSuccess(),
      records: 0,
      truncated: false,
    });
    expect(cell.state).toBe("unreadable");
    expect(cell.lastSuccessAt).toBe(EARLIER);
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
    expect(cell.latestAttemptFailed).toBe(true);
  });
});

describe("googleAdminApiCoverageCell when the read answered", () => {
  it("grades a complete collection synced, stamped with the fill's instant", () => {
    const cell = apiRead({ aggregate: false, truncated: false });
    expect(cell.state).toBe("synced");
    expect(cell.lastSuccessAt).toBe(AT);
    expect(cell.latestAttemptFailed).toBe(false);
    expect(cell.unblockedBy).toBe(null);
    expect(cell.reason).toBe(
      "3 operation(s) were called and stored 40 record(s) to the end of every collection; this claim is bounded by the admin role the granted account holds",
    );
  });

  it("grades a read that hit its page bound deferred and names the bound", () => {
    const cell = apiRead({ aggregate: false, truncated: true });
    expect(cell.state).toBe("deferred");
    expect(cell.reason).toBe(
      "3 operation(s) were called and stored 40 record(s), and the read is knowingly partial — a page bound was reached",
    );
  });

  it("grades an aggregate payload deferred and names the aggregate", () => {
    const cell = apiRead({ aggregate: true, truncated: false });
    expect(cell.state).toBe("deferred");
    expect(cell.reason).toBe(
      "3 operation(s) were called and stored 40 record(s), and the read is knowingly partial — the payload is an aggregate rather than a collection",
    );
  });

  it("names BOTH causes when a page bound was reached and the payload was an aggregate", () => {
    const cell = apiRead({ aggregate: true, truncated: true });
    expect(cell.state).toBe("deferred");
    expect(cell.reason).toBe(
      "3 operation(s) were called and stored 40 record(s), and the read is knowingly partial — a page bound was reached, and the payload is an aggregate rather than a collection",
    );
  });
});
