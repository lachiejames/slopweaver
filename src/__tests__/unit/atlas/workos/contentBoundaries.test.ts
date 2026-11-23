/**
 * The five WorkOS list boundaries, read directly: each accepts a full item carrying every key the official
 * response type declares, and each refuses a key it does not declare by NAME and never by value. A not-JSON
 * body, an added envelope key and a sentinel-valued drift close the set.
 */
import { describe, expect, it } from "vitest";

import {
  WORKOS_CONNECTIONS_LIST,
  WORKOS_DIRECTORIES_LIST,
  WORKOS_MEMBERSHIPS_LIST,
  WORKOS_ORGANIZATIONS_LIST,
  WORKOS_USERS_LIST,
} from "../../../../atlas/workos/contentBoundaries.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** One list page as WorkOS sends it. */
function pageText({ data, after = null }: { data: readonly unknown[]; after?: string | null }): string {
  return JSON.stringify({ data, list_metadata: { after, before: null }, object: "list" });
}

const STAMPS = { created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-02T00:00:00.000Z" };

const FULL_ORGANIZATION = {
  ...STAMPS,
  allow_profiles_outside_organization: false,
  domains: [{ domain: "example.com", id: "org_domain_1", object: "organization_domain", state: "verified" }],
  external_id: null,
  id: "org_1",
  metadata: {},
  name: "One",
  object: "organization",
  stripe_customer_id: "cus_1",
};

const FULL_USER = {
  ...STAMPS,
  email: "person@example.com",
  email_verified: true,
  external_id: "ext_1",
  first_name: "Pat",
  id: "user_1",
  last_name: "Example",
  last_sign_in_at: null,
  locale: null,
  metadata: {},
  name: null,
  object: "user",
  profile_picture_url: null,
};

const FULL_CONNECTION = {
  ...STAMPS,
  connection_type: "OktaSAML",
  domains: [],
  id: "conn_1",
  name: "Okta",
  object: "connection",
  organization_id: "org_1",
  state: "active",
};

const FULL_DIRECTORY = {
  ...STAMPS,
  domain: "example.com",
  external_key: "key_1",
  id: "directory_1",
  metadata: { groups: 1, users: { active: 2, inactive: 0 } },
  name: "Okta SCIM",
  object: "directory",
  organization_id: "org_1",
  state: "linked",
  type: "okta scim v2.0",
};

const FULL_MEMBERSHIP = {
  ...STAMPS,
  custom_attributes: {},
  directory_managed: false,
  id: "om_1",
  object: "organization_membership",
  organization_id: "org_1",
  organization_name: "One",
  role: { slug: "member" },
  roles: [{ slug: "member" }],
  status: "active",
  user_id: "user_1",
};

describe("each list boundary accepts a full item and hands back the cursor", () => {
  it("reads an organisation page", () => {
    const page = unwrap(
      WORKOS_ORGANIZATIONS_LIST.readPage({ text: pageText({ after: "c1", data: [FULL_ORGANIZATION] }) }),
    );
    expect(page.after).toBe("c1");
    expect(page.records.map((record) => [record.id, record.name, record.domains.length])).toEqual([
      ["org_1", "One", 1],
    ]);
  });

  // Measured live: three of the four list endpoints send this camelCase twin beside `list_metadata`.
  it("reads a page carrying the camelCase listMetadata twin, and pages on list_metadata alone", () => {
    const text = JSON.stringify({
      data: [FULL_CONNECTION],
      list_metadata: { after: "c2", before: null },
      listMetadata: { after: "ignored", before: null },
      object: "list",
    });
    expect(unwrap(WORKOS_CONNECTIONS_LIST.readPage({ text })).after).toBe("c2");
  });

  // Measured live: the users listing does NOT send the twin, so one arriving there is drift.
  it("refuses the camelCase twin on the users listing, which was measured not to send it", () => {
    const text = JSON.stringify({
      data: [FULL_USER],
      list_metadata: { after: null, before: null },
      listMetadata: { after: null, before: null },
      object: "list",
    });
    expect(unwrapErr(WORKOS_USERS_LIST.readPage({ text })).message).toBe(
      'GET /user_management/users answered a shape this version does not read — refused, not guessed: new field "listMetadata"',
    );
  });

  it("reads a user page", () => {
    const page = unwrap(WORKOS_USERS_LIST.readPage({ text: pageText({ data: [FULL_USER] }) }));
    expect(page.after).toBe(null);
    expect(page.records.map((record) => [record.id, record.email_verified])).toEqual([["user_1", true]]);
  });

  it("reads a connection page", () => {
    const page = unwrap(WORKOS_CONNECTIONS_LIST.readPage({ text: pageText({ data: [FULL_CONNECTION] }) }));
    expect(page.records.map((record) => [record.id, record.connection_type, record.state])).toEqual([
      ["conn_1", "OktaSAML", "active"],
    ]);
  });

  it("reads a directory page", () => {
    const page = unwrap(WORKOS_DIRECTORIES_LIST.readPage({ text: pageText({ data: [FULL_DIRECTORY] }) }));
    expect(page.records.map((record) => [record.id, record.type, record.state])).toEqual([
      ["directory_1", "okta scim v2.0", "linked"],
    ]);
  });

  it("reads a membership page", () => {
    const page = unwrap(WORKOS_MEMBERSHIPS_LIST.readPage({ text: pageText({ data: [FULL_MEMBERSHIP] }) }));
    expect(page.records.map((record) => [record.user_id, record.organization_id])).toEqual([["user_1", "org_1"]]);
  });

  it("refuses a key WorkOS added to an organisation's domain, since that object is declared too", () => {
    const domain = { ...FULL_ORGANIZATION.domains[0], verified_at: "2026-10-01T00:00:00.000Z" };
    const text = pageText({ data: [{ ...FULL_ORGANIZATION, domains: [domain] }] });
    expect(unwrapErr(WORKOS_ORGANIZATIONS_LIST.readPage({ text })).message).toBe(
      'GET /organizations answered a shape this version does not read — refused, not guessed: new field "data[0].domains[0].verified_at"',
    );
  });
});

describe("each list boundary refuses drift by key", () => {
  it("refuses a body that is not JSON", () => {
    expect(unwrapErr(WORKOS_USERS_LIST.readPage({ text: "<html>" })).code).toBe("BOUNDARY_NOT_JSON");
  });

  it("refuses an envelope key WorkOS added", () => {
    const text = JSON.stringify({ data: [], has_more: false, list_metadata: { after: null }, object: "list" });
    expect(unwrapErr(WORKOS_DIRECTORIES_LIST.readPage({ text })).message).toBe(
      'GET /directories answered a shape this version does not read — refused, not guessed: new field "has_more"',
    );
  });

  it("refuses an item key WorkOS added, naming the key and never the value it carried", () => {
    const text = pageText({ data: [{ ...FULL_USER, password_hash: "DO_NOT_ECHO_51c2" }] });
    const message = unwrapErr(WORKOS_USERS_LIST.readPage({ text })).message;
    expect(message).toBe(
      'GET /user_management/users answered a shape this version does not read — refused, not guessed: new field "data[0].password_hash"',
    );
    expect(text).toContain("DO_NOT_ECHO_51c2");
    expect(message).not.toContain("DO_NOT_ECHO_51c2");
  });

  it("refuses a blank required value rather than publishing it", () => {
    const text = pageText({ data: [{ ...FULL_DIRECTORY, state: "   " }] });
    expect(unwrapErr(WORKOS_DIRECTORIES_LIST.readPage({ text })).message).toContain('field "data[0].state" changed');
  });

  it("refuses an empty-string cursor, which would ask for the first page again", () => {
    const text = pageText({ after: "", data: [] });
    expect(unwrapErr(WORKOS_CONNECTIONS_LIST.readPage({ text })).message).toContain(
      'field "list_metadata.after" changed',
    );
  });
});
