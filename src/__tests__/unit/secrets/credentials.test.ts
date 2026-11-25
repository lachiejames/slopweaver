import { describe, expect, it } from "vitest";

import { ATLAS_CREDENTIALS } from "../../../secrets/credentials/atlas.js";
import { CONNECTOR_CREDENTIALS } from "../../../secrets/credentials/connectors.js";
import { GRANT_CREDENTIALS } from "../../../secrets/credentials/grants.js";
import { OAUTH_CLIENT_CREDENTIALS } from "../../../secrets/credentials/oauthClients.js";
import { RETIRED_CREDENTIALS } from "../../../secrets/credentials/retired.js";
import { SERVICE_ACCESS_CREDENTIALS } from "../../../secrets/credentials/serviceAccess.js";
import { STORE_AND_BACKUP_CREDENTIALS } from "../../../secrets/credentials/storeAndBackup.js";
import { CREDENTIALS } from "../../../secrets/registry.js";

/*
 * The two properties a category file can break that the register's own suite cannot see: a row dropping out of
 * the one array every reader of `CREDENTIALS` uses, and the register's reading order silently changing. Row
 * CONTENTS stay `registry.test.ts`'s and the `secrets-registry` gate's subject for the whole set.
 */
const CATEGORIES = [
  {
    label: "connectors",
    names: [
      "github-token",
      "slack-bot-token",
      "slack-user-token",
      "slack-app-token",
      "linear-token",
      "fathom-api-key",
      "notion-token",
    ],
    rows: CONNECTOR_CREDENTIALS,
  },
  {
    label: "service access",
    names: [
      "datadog-api-key",
      "datadog-app-key",
      "cloudflare-token",
      "onepassword-events-token",
      "onepassword-atlas-password",
      "hex-api-token",
      "knowbe4-api-token",
      "twilio-account-sid",
      "twilio-api-key-sid",
      "twilio-api-key-secret",
      "knock-api-key",
    ],
    rows: SERVICE_ACCESS_CREDENTIALS,
  },
  {
    label: "OAuth clients",
    names: [
      "google-admin-client-id",
      "google-admin-client-secret",
      "google-client-id",
      "google-client-secret",
      "google-secops-client-id",
      "google-secops-client-secret",
      "outlook-client-id",
      "google-secops-instance",
    ],
    rows: OAUTH_CLIENT_CREDENTIALS,
  },
  {
    label: "atlas",
    names: [
      "vanta-client-id",
      "vanta-client-secret",
      "vanta-tenant-slug",
      "crowdstrike-api-host",
      "crowdstrike-client-id",
      "crowdstrike-client-secret",
      "trelica-tenant-host",
      "graphql-hive-token",
      "make-api-token",
      "make-zone",
      "workos-api-key",
      "jumpcloud-api-key",
      "jumpcloud-org-id",
      "playwright-extension-token",
    ],
    rows: ATLAS_CREDENTIALS,
  },
  {
    label: "store and backup",
    names: ["store-url", "backup-passphrase", "store-backup-directory"],
    rows: STORE_AND_BACKUP_CREDENTIALS,
  },
  {
    label: "grants",
    names: [
      "chatgpt-web-session.json",
      "gmail-oauth.json",
      "outlook-oauth.json",
      "outlook-calendar-oauth.json",
      "drive-oauth.json",
      "calendar-oauth.json",
      "google-admin-oauth.json",
      "google-secops-oauth.json",
    ],
    rows: GRANT_CREDENTIALS,
  },
  {
    label: "retired",
    names: ["gmail-client-id", "gmail-client-secret", "openai-api-key", "store-api-url", "store-service-key"],
    rows: RETIRED_CREDENTIALS,
  },
] as const;

describe("the register's category files", () => {
  it.each(CATEGORIES)("$label declares exactly its rows, in register order", ({ names, rows }) => {
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.name)).toEqual(names);
  });

  it("are spread into the one register contiguously, in category order, as the very same row objects", () => {
    expect(CREDENTIALS.length).toBe(56);
    expect(CREDENTIALS).toStrictEqual(CATEGORIES.flatMap((category) => [...category.rows]));
    expect(CATEGORIES.map((category) => CREDENTIALS.indexOf(category.rows[0]))).toEqual([0, 7, 18, 26, 40, 43, 51]);
  });
});
