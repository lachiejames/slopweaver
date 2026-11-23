/**
 * The organisation row's witness: absent until written, written whole and read back by the real write, replaced at
 * the next revision, and a write pinned to a revision that moved refused with nothing written.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. The row is a
 * SINGLETON, so point it at a THROWAWAY database in the running stack — never `postgres`, which is the live fleet's:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres organisation_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/organisation_proof slopweaver store push
 *   ORGANISATION_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/organisation_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/organisationStore.test.ts
 *
 * The row is deleted before and after.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../lib/result.js";
import type { OrganisationRecord } from "../../organisation/core.js";
import { readStoredOrganisation, writeStoredOrganisation } from "../../organisation/store.js";
import { writeOverClient } from "../../organisation/write.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { ORGANISATION_ID, organisationTable } from "../../store/schema/organisation.js";
import { FIXTURE_SELF_REPOSITORY } from "../organisationFixture.js";

const PROOF_URL = process.env["ORGANISATION_PROOF_URL"];

const ACME: OrganisationRecord = {
  dependencyBots: ["acme-bot"],
  displayName: "Acme",
  githubOwner: "acme",
  googleDomain: "acme.com",
  linearWorkspace: "acme",
  repositories: ["acme/acme-admin"],
  slackHosts: ["acme.slack.com"],
  vantaWorkspace: "acme",
};

const GLOBEX: OrganisationRecord = {
  dependencyBots: [],
  displayName: "Globex",
  githubOwner: "globex",
  googleDomain: null,
  linearWorkspace: null,
  repositories: ["globex/web", "globex/api"],
  // No Slack: the empty `text[]` must round-trip unchanged, never come back null.
  slackHosts: [],
  vantaWorkspace: null,
};

describe.skipIf(PROOF_URL === undefined)("the organisation row (live store)", () => {
  let client: StoreClient;

  beforeAll(async () => {
    client = openStore({ url: PROOF_URL! });
    await client.db.delete(organisationTable).where(eq(organisationTable.id, ORGANISATION_ID));
  });

  afterAll(async () => {
    await client.db.delete(organisationTable).where(eq(organisationTable.id, ORGANISATION_ID));
    await client.close();
  });

  it("reads a store nobody has written as not configured, naming the whole organisation", async () => {
    const read = unwrapErr(await readStoredOrganisation({ client }));
    expect(read.code).toBe("ORG_NOT_CONFIGURED");
    expect(read.message).toContain("no organisation is configured in the store");
  });

  it("creates the row at revision 1, then replaces it whole at revision 2", async () => {
    const created = unwrap(await writeOverClient({ client, record: ACME, selfRepository: FIXTURE_SELF_REPOSITORY }));
    expect(created.revision).toBe(1);
    expect(created.githubOwner).toBe("acme");
    const replaced = unwrap(await writeOverClient({ client, record: GLOBEX, selfRepository: FIXTURE_SELF_REPOSITORY }));
    expect(replaced.revision).toBe(2);
    expect(replaced.selfRepository).toBe(FIXTURE_SELF_REPOSITORY);
    expect(unwrap(await readStoredOrganisation({ client })).record).toEqual(GLOBEX);
  });

  it("refuses a write pinned to a revision that moved, and leaves the row as it was", async () => {
    const stale = await writeStoredOrganisation({ client, expectedRevision: 1, record: ACME });
    expect(unwrapErr(stale).message).toContain("moved from revision 1 to 2");
    expect(unwrap(await readStoredOrganisation({ client })).record).toEqual(GLOBEX);
  });
});
