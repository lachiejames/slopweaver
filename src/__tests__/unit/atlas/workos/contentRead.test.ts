/**
 * The paged reader and the four reducers.
 *
 * The property worth pinning hardest is the bound: a read that stopped because the reader ran out of pages
 * must SAY so, because `syncCoverage.ts` turns that into a `deferred` cell rather than publishing a prefix as a
 * complete family. The second is that a record the strict boundary refuses refuses its whole page, by key,
 * rather than being skipped or defaulted on its way into a reducer.
 */
import { describe, expect, it } from "vitest";

import type { WorkosFetch } from "../../../../atlas/workos/client.js";
import {
  WORKOS_CONNECTIONS_LIST,
  WORKOS_DIRECTORIES_LIST,
  WORKOS_ORGANIZATIONS_LIST,
  WORKOS_USERS_LIST,
} from "../../../../atlas/workos/contentBoundaries.js";
import {
  readWorkosList,
  reduceWorkosConnections,
  reduceWorkosDirectories,
  reduceWorkosMemberships,
  reduceWorkosOrganizations,
  reduceWorkosUsers,
  WORKOS_MAX_MEMBERSHIP_WALKS,
  WORKOS_MAX_PAGES,
  walkWorkosMemberships,
} from "../../../../atlas/workos/contentRead.js";
import { WorkosApiErrors } from "../../../../atlas/workos/errors.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** The prefix every strict-boundary refusal of one list endpoint opens with. */
function refusedBy({ path }: { path: string }): string {
  return `GET ${path} answered a shape this version does not read — refused, not guessed: `;
}

/** One list page as WorkOS sends it. */
function pageText({ data, after = null }: { data: readonly unknown[]; after?: string | null }): string {
  return JSON.stringify({ data, list_metadata: { after, before: null }, object: "list" });
}

/** A fake transport answering every call with one page. */
function answering({ data }: { data: readonly unknown[] }): WorkosFetch {
  return () => Promise.resolve({ status: 200, text: pageText({ data }) });
}

/** One organisation carrying every key the boundary requires. */
function organization({ id }: { id: string }): Record<string, unknown> {
  return { domains: [], id, name: `Organisation ${id}`, object: "organization" };
}

/** A fake transport answering one fixed page whose cursor never runs out. */
function endlessFetch(): WorkosFetch {
  return () =>
    Promise.resolve({ status: 200, text: pageText({ after: "cursor", data: [organization({ id: "org_1" })] }) });
}

/** A fake transport answering two pages and then stopping. */
function twoPageFetch(): WorkosFetch {
  let call = 0;
  return () => {
    call += 1;
    const text =
      call === 1
        ? pageText({ after: "c1", data: [organization({ id: "org_1" })] })
        : pageText({ data: [organization({ id: "org_2" })] });
    return Promise.resolve({ status: 200, text });
  };
}

describe("readWorkosList", () => {
  it("follows the cursor and returns every page's records in order", async () => {
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_ORGANIZATIONS_LIST, fetch: twoPageFetch() });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read).records.map((record) => record.id)).toEqual(["org_1", "org_2"]);
  });

  it("reports a complete read as untruncated", async () => {
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_ORGANIZATIONS_LIST, fetch: twoPageFetch() });
    expect(unwrap(read).truncated).toBe(false);
  });

  it("stops at the bound and SAYS it stopped, rather than publishing a prefix as complete", async () => {
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_ORGANIZATIONS_LIST, fetch: endlessFetch() });
    expect(unwrap(read).truncated).toBe(true);
    expect(unwrap(read).records.length).toBe(WORKOS_MAX_PAGES);
  });

  it("carries a failed page's typed error out rather than returning a short list", async () => {
    const fetch: WorkosFetch = () => Promise.resolve({ status: 401, text: '{"message":"Unauthorized"}' });
    const read = await readWorkosList({ apiKey: "sk_bad", endpoint: WORKOS_ORGANIZATIONS_LIST, fetch });
    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr().code).toBe("HTTP_STATUS");
  });

  it("sends the filter a listing REQUIRES beside the page limit", async () => {
    const { fetch, urls } = urlRecordingFetch({ pages: [pageText({ data: [] })] });
    await walkWorkosMemberships({ apiKey: "sk", fetch, filter: "organization_id", ids: ["org_1"] });
    expect(urls).toEqual([
      "https://api.workos.com/user_management/organization_memberships?limit=100&organization_id=org_1",
    ]);
  });

  it("keeps the filter on the SECOND page, so a walk does not lose it at the cursor", async () => {
    const { fetch, urls } = urlRecordingFetch({ pages: [pageText({ after: "c1", data: [] }), pageText({ data: [] })] });
    await walkWorkosMemberships({ apiKey: "sk", fetch, filter: "organization_id", ids: ["org_1"] });
    expect(urls[1]).toBe(
      "https://api.workos.com/user_management/organization_memberships?limit=100&organization_id=org_1&after=c1",
    );
  });

  it("sends no filter at all when a listing needs none", async () => {
    const { fetch, urls } = urlRecordingFetch({ pages: [pageText({ data: [] })] });
    await readWorkosList({ apiKey: "sk", endpoint: WORKOS_ORGANIZATIONS_LIST, fetch });
    expect(urls).toEqual(["https://api.workos.com/organizations?limit=100"]);
  });
});

/**
 * A fake transport that records every URL it was asked for and answers the given pages in order.
 *
 * @param pages the page bodies to answer, one per call, the last repeating
 * @returns the transport and the list it fills
 */
function urlRecordingFetch({ pages }: { pages: readonly string[] }): {
  fetch: WorkosFetch;
  urls: string[];
} {
  const urls: string[] = [];
  return {
    fetch: ({ url }) => {
      const text = pages[Math.min(urls.length, pages.length - 1)]!;
      urls.push(url);
      return Promise.resolve({ status: 200, text });
    },
    urls,
  };
}

describe("walkWorkosMemberships", () => {
  /** A transport answering one membership per organisation id it is filtered by. */
  function perOrganizationFetch(): { fetch: WorkosFetch; urls: string[] } {
    const urls: string[] = [];
    return {
      fetch: ({ url }) => {
        urls.push(url);
        const organizationId = new URL(url).searchParams.get("organization_id")!;
        return Promise.resolve({
          status: 200,
          text: pageText({ data: [{ organization_id: organizationId, user_id: `user_of_${organizationId}` }] }),
        });
      },
      urls,
    };
  }

  it("asks the listing once per id, filtered, because it refuses to be listed whole", async () => {
    const { fetch, urls } = perOrganizationFetch();
    await walkWorkosMemberships({ apiKey: "sk", fetch, filter: "organization_id", ids: ["org_1", "org_2"] });
    expect(urls).toEqual([
      "https://api.workos.com/user_management/organization_memberships?limit=100&organization_id=org_1",
      "https://api.workos.com/user_management/organization_memberships?limit=100&organization_id=org_2",
    ]);
  });

  it("groups every listing's records by user", async () => {
    const { fetch } = perOrganizationFetch();
    const walk = await walkWorkosMemberships({
      apiKey: "sk",
      fetch,
      filter: "organization_id",
      ids: ["org_1", "org_2"],
    });
    expect(walk.membershipsByUser.get("user_of_org_1")).toEqual(["org_1"]);
    expect(walk.membershipsByUser.get("user_of_org_2")).toEqual(["org_2"]);
  });

  it("walks by user id when that is the filter it was given", async () => {
    const urls: string[] = [];
    const fetch: WorkosFetch = ({ url }) => {
      urls.push(url);
      return Promise.resolve({ status: 200, text: pageText({ data: [] }) });
    };
    await walkWorkosMemberships({ apiKey: "sk", fetch, filter: "user_id", ids: ["user_1"] });
    expect(urls).toEqual(["https://api.workos.com/user_management/organization_memberships?limit=100&user_id=user_1"]);
  });

  it("asks nothing at all for an empty id list, and reports neither a failure nor a bound", async () => {
    const urls: string[] = [];
    const fetch: WorkosFetch = ({ url }) => {
      urls.push(url);
      return Promise.resolve({ status: 200, text: pageText({ data: [] }) });
    };
    const walk = await walkWorkosMemberships({ apiKey: "sk", fetch, filter: "organization_id", ids: [] });
    expect(urls).toEqual([]);
    expect(walk.failedBecause).toBe(null);
    expect(walk.truncated).toBe(false);
  });

  // If the filter itself is wrong again, the alternative is a hundred identical refusals at the vendor.
  it("stops at the FIRST refusal rather than walking the rest, and names it", async () => {
    const urls: string[] = [];
    const fetch: WorkosFetch = ({ url }) => {
      urls.push(url);
      return Promise.resolve({ status: 400, text: '{"message":"Either organization_id or user_id is required."}' });
    };
    const walk = await walkWorkosMemberships({
      apiKey: "sk",
      fetch,
      filter: "organization_id",
      ids: ["org_1", "org_2", "org_3"],
    });
    expect(urls.length).toBe(1);
    expect(walk.failedBecause).toContain("Either organization_id or user_id is required.");
  });

  it("keeps what it had already grouped when a later listing refuses", async () => {
    const urls: string[] = [];
    const fetch: WorkosFetch = ({ url }) => {
      urls.push(url);
      const answered: Record<number, { status: number; text: string }> = {
        1: { status: 200, text: pageText({ data: [{ organization_id: "org_1", user_id: "user_1" }] }) },
        2: { status: 400, text: '{"message":"nope"}' },
      };
      return Promise.resolve(answered[urls.length]!);
    };
    const walk = await walkWorkosMemberships({
      apiKey: "sk",
      fetch,
      filter: "organization_id",
      ids: ["org_1", "org_2"],
    });
    expect(walk.membershipsByUser.get("user_1")).toEqual(["org_1"]);
    expect(walk.truncated).toBe(true);
  });

  it("stops at its bound and SAYS it stopped, rather than publishing a prefix as whole", async () => {
    const { fetch, urls } = perOrganizationFetch();
    const ids = Array.from({ length: WORKOS_MAX_MEMBERSHIP_WALKS + 5 }, (_unused, index) => `org_${String(index)}`);
    const walk = await walkWorkosMemberships({ apiKey: "sk", fetch, filter: "organization_id", ids });
    expect(urls.length).toBe(WORKOS_MAX_MEMBERSHIP_WALKS);
    expect(walk.truncated).toBe(true);
  });

  it("reports a complete walk as untruncated", async () => {
    const { fetch } = perOrganizationFetch();
    const walk = await walkWorkosMemberships({ apiKey: "sk", fetch, filter: "organization_id", ids: ["org_1"] });
    expect(walk.truncated).toBe(false);
    expect(walk.failedBecause).toBe(null);
  });

  it("reports a listing that filled every page as truncated, since the rest was never seen", async () => {
    const fetch: WorkosFetch = () =>
      Promise.resolve({
        status: 200,
        text: pageText({ after: "cursor", data: [{ organization_id: "org_1", user_id: "user_1" }] }),
      });
    const walk = await walkWorkosMemberships({ apiKey: "sk", fetch, filter: "organization_id", ids: ["org_1"] });
    expect(walk.truncated).toBe(true);
    expect(walk.membershipsByUser.get("user_1")).toEqual(["org_1"]);
  });
});

describe("the cursor a page hands back", () => {
  it("reads `after: null` as the last page, and asks for no other", async () => {
    const { fetch, urls } = urlRecordingFetch({ pages: [pageText({ data: [organization({ id: "org_1" })] })] });
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_ORGANIZATIONS_LIST, fetch });
    expect(urls.length).toBe(1);
    expect(unwrap(read).truncated).toBe(false);
  });

  it("refuses a page with no list_metadata, rather than reading it as the last page", async () => {
    const fetch: WorkosFetch = () => Promise.resolve({ status: 200, text: '{"data":[]}' });
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_ORGANIZATIONS_LIST, fetch });
    expect(unwrapErr(read)).toStrictEqual(
      WorkosApiErrors.responseChanged({
        message: `${refusedBy({ path: "/organizations" })}field "list_metadata" is missing`,
      }),
    );
  });

  it("refuses a cursor that is not a string", async () => {
    const fetch: WorkosFetch = () =>
      Promise.resolve({ status: 200, text: JSON.stringify({ data: [], list_metadata: { after: 7 } }) });
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_ORGANIZATIONS_LIST, fetch });
    expect(unwrapErr(read).code).toBe("RESPONSE_CHANGED");
    expect(unwrapErr(read).message).toContain('field "list_metadata.after" changed');
  });
});

describe("reduceWorkosOrganizations", () => {
  it("keeps the id, the name and the domain COUNT, sorted by id", () => {
    const reduced = reduceWorkosOrganizations({
      records: [
        { domains: [{ domain: "b.example" }], id: "org_2", name: "Two" },
        { domains: [], id: "org_1", name: "One" },
      ],
    });
    expect(reduced).toEqual([
      { domainCount: 0, id: "org_1", name: "One" },
      { domainCount: 1, id: "org_2", name: "Two" },
    ]);
  });

  it("refuses an organisation carrying no id, since it cannot be given a stable identity", async () => {
    const fetch = answering({ data: [{ domains: [], name: "nameless" }] });
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_ORGANIZATIONS_LIST, fetch });
    expect(unwrapErr(read).message).toBe(`${refusedBy({ path: "/organizations" })}field "data[0].id" is missing`);
  });

  it("refuses an organisation carrying no name, which WorkOS declares required, rather than naming it by id", async () => {
    const fetch = answering({ data: [{ domains: [], id: "org_1" }] });
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_ORGANIZATIONS_LIST, fetch });
    expect(unwrapErr(read)).toStrictEqual(
      WorkosApiErrors.responseChanged({
        message: `${refusedBy({ path: "/organizations" })}field "data[0].name" is missing`,
      }),
    );
  });
});

describe("reduceWorkosMemberships", () => {
  it("groups organisation ids under the user they belong to, deduplicated and sorted", () => {
    const grouped = reduceWorkosMemberships({
      records: [
        { organization_id: "org_2", user_id: "user_1" },
        { organization_id: "org_1", user_id: "user_1" },
        { organization_id: "org_1", user_id: "user_1" },
      ],
    });
    expect(grouped.get("user_1")).toEqual(["org_1", "org_2"]);
  });

  it("refuses a membership missing either side of the pair, rather than skipping it", async () => {
    const fetch = answering({ data: [{ user_id: "user_1" }] });
    const walk = await walkWorkosMemberships({ apiKey: "sk", fetch, filter: "organization_id", ids: ["org_1"] });
    expect(walk.failedBecause).toBe(
      `${refusedBy({ path: "/user_management/organization_memberships" })}field "data[0].organization_id" is missing`,
    );
  });
});

describe("reduceWorkosUsers", () => {
  it("takes the organisation ids from the memberships read, since the user object carries none", () => {
    const reduced = reduceWorkosUsers({
      membershipsByUser: new Map([["user_1", ["org_1"]]]),
      records: [{ email_verified: true, id: "user_1" }],
    });
    expect(reduced).toEqual([{ emailVerified: true, id: "user_1", organizationIds: ["org_1"] }]);
  });

  it("refuses a user carrying no email_verified, rather than reading it as false", async () => {
    const fetch = answering({ data: [{ id: "user_1" }] });
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_USERS_LIST, fetch });
    expect(unwrapErr(read).message).toBe(
      `${refusedBy({ path: "/user_management/users" })}field "data[0].email_verified" is missing`,
    );
  });
});

describe("reduceWorkosConnections", () => {
  it("keeps the type, the organisation and the state", () => {
    const reduced = reduceWorkosConnections({
      records: [{ connection_type: "OktaSAML", id: "conn_1", organization_id: "org_1", state: "active" }],
    });
    expect(reduced).toEqual([{ connectionType: "OktaSAML", id: "conn_1", organizationId: "org_1", state: "active" }]);
  });

  it("refuses a connection carrying a certificate URL, naming the key and never the URL", async () => {
    const fetch = answering({
      data: [
        {
          connection_type: "OktaSAML",
          id: "conn_1",
          saml_idp_metadata_url: "https://idp.example/metadata",
          state: "active",
        },
      ],
    });
    const message = unwrapErr(await readWorkosList({ apiKey: "sk", endpoint: WORKOS_CONNECTIONS_LIST, fetch })).message;
    expect(message).toBe(`${refusedBy({ path: "/connections" })}new field "data[0].saml_idp_metadata_url"`);
    expect(message).not.toContain("idp.example");
  });

  it("records an absent organization_id, which WorkOS declares optional, as `unknown`", () => {
    const reduced = reduceWorkosConnections({
      records: [{ connection_type: "OktaSAML", id: "conn_1", state: "active" }],
    });
    expect(reduced[0]!.organizationId).toBe("unknown");
  });

  it("refuses a connection carrying no connection_type, which WorkOS declares required", async () => {
    const fetch = answering({ data: [{ id: "conn_1", state: "active" }] });
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_CONNECTIONS_LIST, fetch });
    expect(unwrapErr(read)).toStrictEqual(
      WorkosApiErrors.responseChanged({
        message: `${refusedBy({ path: "/connections" })}field "data[0].connection_type" is missing`,
      }),
    );
  });

  it("refuses a connection carrying no state, which WorkOS declares required", async () => {
    const fetch = answering({ data: [{ connection_type: "OktaSAML", id: "conn_1" }] });
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_CONNECTIONS_LIST, fetch });
    expect(unwrapErr(read).message).toBe(`${refusedBy({ path: "/connections" })}field "data[0].state" is missing`);
  });

  it("refuses an organization_id that is present and not a string, rather than reading it as `unknown`", async () => {
    const fetch = answering({
      data: [{ connection_type: "OktaSAML", id: "conn_1", organization_id: 7, state: "active" }],
    });
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_CONNECTIONS_LIST, fetch });
    expect(unwrapErr(read).message).toContain('field "data[0].organization_id" changed');
  });
});

describe("reduceWorkosDirectories", () => {
  it("keeps the directory type, organisation and state", () => {
    const reduced = reduceWorkosDirectories({
      records: [{ id: "directory_1", organization_id: "org_1", state: "linked", type: "okta scim v2.0" }],
    });
    expect(reduced).toEqual([
      { directoryType: "okta scim v2.0", id: "directory_1", organizationId: "org_1", state: "linked" },
    ]);
  });

  it("records a null organization_id, which WorkOS declares optional, as `unknown`", () => {
    const reduced = reduceWorkosDirectories({
      records: [{ id: "directory_1", organization_id: null, state: "linked", type: "okta scim v2.0" }],
    });
    expect(reduced[0]!.organizationId).toBe("unknown");
  });

  it("refuses a directory carrying no type, which WorkOS declares required", async () => {
    const fetch = answering({ data: [{ id: "directory_1", state: "linked" }] });
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_DIRECTORIES_LIST, fetch });
    expect(unwrapErr(read)).toStrictEqual(
      WorkosApiErrors.responseChanged({
        message: `${refusedBy({ path: "/directories" })}field "data[0].type" is missing`,
      }),
    );
  });

  it("refuses a directory carrying no state, which WorkOS declares required", async () => {
    const fetch = answering({ data: [{ id: "directory_1", type: "okta scim v2.0" }] });
    const read = await readWorkosList({ apiKey: "sk", endpoint: WORKOS_DIRECTORIES_LIST, fetch });
    expect(unwrapErr(read).message).toBe(`${refusedBy({ path: "/directories" })}field "data[0].state" is missing`);
  });
});
