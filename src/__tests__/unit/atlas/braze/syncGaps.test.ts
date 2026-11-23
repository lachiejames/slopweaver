/**
 * `brazeOperationGaps` and `brazeOperationRechecks`, over a hand-built observation whose every row, id and
 * name is distinct, so a gap or recheck built from the wrong row, set or channel shows as the wrong value.
 */
import { describe, expect, it } from "vitest";

import type { BrazeCollectionOperationRow } from "../../../../atlas/braze/collection.js";
import type { BrazeDocsOperationRow } from "../../../../atlas/braze/docsCatalogue.js";
import { openBrazeGap, reconcileBrazeGaps } from "../../../../atlas/braze/gaps.js";
import {
  type BrazeKindObservation,
  brazeDeadRuleIds,
  brazeOperationGaps,
  brazeOperationRechecks,
} from "../../../../atlas/braze/syncGaps.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-10-12T00:00:00.000Z";

const SHARED = "POST /shared";
const DOCS_ONLY = "GET /docs-only";
const COLLECTION_ONLY = "DELETE /collection-only";

/** One documented operation, classified by `ruleId`, with every other field distinct to its provider id. */
function docsRow({ providerId, ruleId }: { providerId: string; ruleId: string }): BrazeDocsOperationRow {
  return {
    disposition: "reachable",
    dispositionReason: `reviewed ${providerId}`,
    dispositionRuleId: ruleId,
    kind: "email",
    lastModified: AT,
    method: providerId.split(" ")[0]!,
    parameters: [],
    pathDefect: null,
    pathShape: providerId.split(" ")[1]!,
    providerId,
    rateLimit: null,
    responseFields: [],
    title: `Docs title for ${providerId}`,
    url: `https://www.braze.com/docs/${providerId}`,
  };
}

/** One collection request, classified by `ruleId`, with a name of its own and every other field distinct. */
function collectionRow({
  providerId,
  name,
  ruleId,
}: {
  providerId: string;
  name: string;
  ruleId: string;
}): BrazeCollectionOperationRow {
  return {
    disposition: "reachable",
    dispositionReason: `reviewed ${providerId}`,
    dispositionRuleId: ruleId,
    folders: ["Email"],
    headers: [],
    method: providerId.split(" ")[0]!,
    name,
    pathDefect: null,
    pathShape: providerId.split(" ")[1]!,
    providerId,
    queryParams: [],
    requestBodyFields: [],
  };
}

/**
 * Every reviewed rule. `rule-docs` fires only on a docs row and `rule-live` only on the collection-only row,
 * so a dead-rule scan of one channel alone would call the other channel's rule dead. `rule-elsewhere` fires
 * only on another kind's row, so a scan of this kind's rows alone would call it dead. `rule-dead` fires on
 * nothing.
 */
const REVIEWED_RULE_IDS = ["rule-docs", "rule-live", "rule-elsewhere", "rule-shared", "rule-dead"];

const DOCS_ROWS = [
  docsRow({ providerId: SHARED, ruleId: "rule-shared" }),
  docsRow({ providerId: DOCS_ONLY, ruleId: "rule-docs" }),
];

/** In the opposite order to `DOCS_ROWS`, so no index holds the same provider id or rule on both channels. */
const COLLECTION_ROWS = [
  collectionRow({ name: "Collection-only request", providerId: COLLECTION_ONLY, ruleId: "rule-live" }),
  collectionRow({ name: "Shared request", providerId: SHARED, ruleId: "rule-shared" }),
];

/** A row from another kind, which only the run-wide rows carry. */
const ELSEWHERE_ROW = docsRow({ providerId: "GET /another-kind", ruleId: "rule-elsewhere" });

/**
 * One shared operation, one only the docs have, one only the collection has, a malformed address on each
 * channel, and the run's rows across every kind, from which the dead rules are derived. `collectionOnly` also
 * names an id no row carries, so a gap raised from the set rather than from the rows would show.
 */
const OBSERVATION: BrazeKindObservation = {
  at: AT,
  collectionOnly: new Set([COLLECTION_ONLY, "PUT /in-the-set-but-no-row"]),
  collectionRows: COLLECTION_ROWS,
  docsRows: DOCS_ROWS,
  kind: "email",
  malformed: [
    { channel: "docs", detail: "doubles a slash", providerId: DOCS_ONLY },
    { channel: "collection", detail: "names an unset host variable", providerId: COLLECTION_ONLY },
  ],
  reviewedRuleIds: REVIEWED_RULE_IDS,
  runRows: [...DOCS_ROWS, ELSEWHERE_ROW, ...COLLECTION_ROWS],
};

/** The two gaps every kind carries, which only a credential closes. */
const CREDENTIAL_GAPS = [
  openBrazeGap({
    at: AT,
    condition: "rest-credential-absent",
    fields: [],
    kind: "email",
    reason:
      "the published surfaces say what Braze offers for this kind; nothing has asked this workspace for any of it, because no API key exists to ask with",
    scope: "email",
    surfaces: ["api"],
  }),
  openBrazeGap({
    at: AT,
    condition: "browser-account-absent",
    fields: [],
    kind: "email",
    reason:
      "no Braze account exists on this installation, so no dashboard page governing this kind has been reached. MEASURED: the dashboard answers a sign-in wall and no invitation was ever issued",
    scope: "email",
    surfaces: ["browser"],
  }),
];

/** The dead-rule gap `rule-dead` raises. */
const DEAD_RULE_GAP = openBrazeGap({
  at: AT,
  condition: "disposition-rule-never-fired",
  fields: [],
  kind: null,
  reason:
    "the reviewed disposition rule `rule-dead` matched no operation on either published surface — a dead rule reads as considered judgement and is not one",
  scope: "rule-dead",
  surfaces: ["docs", "collection"],
});

describe("brazeDeadRuleIds", () => {
  it("calls dead only the rule no row carries, counting a rule fired on either channel or another kind alone", () => {
    expect(brazeDeadRuleIds({ reviewedRuleIds: REVIEWED_RULE_IDS, rows: OBSERVATION.runRows })).toEqual(["rule-dead"]);
  });

  it("calls every reviewed rule dead, in declaration order, when no row was read", () => {
    expect(brazeDeadRuleIds({ reviewedRuleIds: REVIEWED_RULE_IDS, rows: [] })).toEqual(REVIEWED_RULE_IDS);
  });
});

describe("brazeOperationGaps", () => {
  it("raises the credential gaps, both disagreements, both malformed addresses and the dead rule, in that order", () => {
    expect(brazeOperationGaps({ observation: OBSERVATION })).toEqual([
      ...CREDENTIAL_GAPS,
      openBrazeGap({
        at: AT,
        condition: "collection-missing-documented-operation",
        fields: [],
        kind: "email",
        reason:
          "Braze documents `GET /docs-only` and its own official Postman collection does not ship it — only Braze can close this",
        scope: DOCS_ONLY,
        surfaces: ["docs", "collection"],
      }),
      openBrazeGap({
        at: AT,
        condition: "documentation-missing-collection-operation",
        fields: [],
        kind: "email",
        reason:
          'Braze\'s official Postman collection ships `DELETE /collection-only` as "Collection-only request" and its reference has no page for it at all',
        scope: COLLECTION_ONLY,
        surfaces: ["docs", "collection"],
      }),
      openBrazeGap({
        at: AT,
        condition: "published-path-malformed",
        fields: [],
        kind: "email",
        reason:
          "the docs channel publishes an address for `GET /docs-only` that doubles a slash. Recorded rather than repaired — a silently corrected path would hide a defect in a document this repository does not control",
        scope: "docs:GET /docs-only",
        surfaces: ["docs"],
      }),
      openBrazeGap({
        at: AT,
        condition: "published-path-malformed",
        fields: [],
        kind: "email",
        reason:
          "the collection channel publishes an address for `DELETE /collection-only` that names an unset host variable. Recorded rather than repaired — a silently corrected path would hide a defect in a document this repository does not control",
        scope: "collection:DELETE /collection-only",
        surfaces: ["collection"],
      }),
      DEAD_RULE_GAP,
    ]);
  });

  it("raises only the two credential gaps when both channels agree, nothing is malformed and every rule fired", () => {
    const docsRows = [docsRow({ providerId: SHARED, ruleId: "rule-shared" })];
    const collectionRows = [collectionRow({ name: "Shared request", providerId: SHARED, ruleId: "rule-shared" })];
    const clean: BrazeKindObservation = {
      ...OBSERVATION,
      collectionOnly: new Set(),
      collectionRows,
      docsRows,
      malformed: [],
      reviewedRuleIds: ["rule-shared"],
      runRows: [...docsRows, ...collectionRows],
    };

    expect(brazeOperationGaps({ observation: clean })).toEqual(CREDENTIAL_GAPS);
  });
});

describe("brazeOperationRechecks", () => {
  it("rechecks the kind, every row on each channel, and every reviewed rule, all as resolved", () => {
    expect(brazeOperationRechecks({ observation: OBSERVATION })).toEqual([
      { condition: "published-family-undeclared", resolved: true, scope: "email" },
      { condition: "published-page-unreadable", resolved: true, scope: "email" },
      { condition: "collection-missing-documented-operation", resolved: true, scope: SHARED },
      { condition: "published-path-malformed", resolved: true, scope: "docs:POST /shared" },
      { condition: "collection-missing-documented-operation", resolved: true, scope: DOCS_ONLY },
      { condition: "published-path-malformed", resolved: true, scope: "docs:GET /docs-only" },
      { condition: "documentation-missing-collection-operation", resolved: true, scope: COLLECTION_ONLY },
      { condition: "published-path-malformed", resolved: true, scope: "collection:DELETE /collection-only" },
      { condition: "documentation-missing-collection-operation", resolved: true, scope: SHARED },
      { condition: "published-path-malformed", resolved: true, scope: "collection:POST /shared" },
      { condition: "disposition-rule-never-fired", resolved: true, scope: "rule-docs" },
      { condition: "disposition-rule-never-fired", resolved: true, scope: "rule-live" },
      { condition: "disposition-rule-never-fired", resolved: true, scope: "rule-elsewhere" },
      { condition: "disposition-rule-never-fired", resolved: true, scope: "rule-shared" },
      { condition: "disposition-rule-never-fired", resolved: true, scope: "rule-dead" },
    ]);
  });

  it("lets a rule that starts firing close its stored dead-rule gap, while a stored rule still dead stays open", () => {
    const storedDeadRuleGap = ({ ruleId, at }: { ruleId: string; at: string }): ReturnType<typeof openBrazeGap> =>
      openBrazeGap({
        at,
        condition: "disposition-rule-never-fired",
        fields: [],
        kind: null,
        reason: `the reviewed disposition rule \`${ruleId}\` matched no operation on either published surface`,
        scope: ruleId,
        surfaces: ["docs", "collection"],
      });

    const reconciled = unwrap(
      reconcileBrazeGaps({
        at: AT,
        observed: brazeOperationGaps({ observation: OBSERVATION }),
        rechecks: brazeOperationRechecks({ observation: OBSERVATION }),
        runFailed: false,
        stored: [
          storedDeadRuleGap({ at: "2026-10-01T00:00:00.000Z", ruleId: "rule-live" }),
          storedDeadRuleGap({ at: "2026-10-02T00:00:00.000Z", ruleId: "rule-dead" }),
        ],
      }),
    );

    expect(
      reconciled
        .filter((gap) => gap.condition === "disposition-rule-never-fired")
        .map((gap) => [gap.scope, gap.status, gap.firstDetectedAt, gap.lastCheckedAt]),
    ).toEqual([
      ["rule-dead", "open", "2026-10-02T00:00:00.000Z", AT],
      ["rule-live", "closed", "2026-10-01T00:00:00.000Z", AT],
    ]);
  });
});
