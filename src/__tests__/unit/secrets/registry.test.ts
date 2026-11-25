/**
 * The register's own invariants — the ones a reader of `src/secrets/registry.ts` is entitled to assume, and
 * which nothing else checks.
 *
 * `src/devLint/secretsRegistry.ts` checks the register against the CODE and the DOC. These are the checks
 * that stand entirely inside the register: that the allowlist is genuinely derived from it, that no two rows
 * claim the same file, and that a `retired` row and a `settable` row can never be the same row — which is
 * what stops `secrets set` minting fresh dead weight.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CREDENTIALS,
  type CredentialSpec,
  credentialsByName,
  SECRET_NAMES,
  type SecretName,
} from "../../../secrets/registry.js";

/**
 * The settable names, written out independently of the register, in its order. The runtime assertion below
 * pins their values and order; the `expectTypeOf` one makes `tsc` refuse a missing or surplus member of
 * {@link SecretName}, which is derived from the category files' literal tuples through one spread.
 */
const EXPECTED_SECRET_NAMES = [
  "github-token",
  "slack-bot-token",
  "slack-user-token",
  "slack-app-token",
  "linear-token",
  "fathom-api-key",
  "notion-token",
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
  "google-admin-client-id",
  "google-admin-client-secret",
  "google-client-id",
  "google-client-secret",
  "google-secops-client-id",
  "google-secops-client-secret",
  "outlook-client-id",
  "google-secops-instance",
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
  "store-url",
  "backup-passphrase",
  "store-backup-directory",
] as const;

/**
 * The register, widened to its declared element type. `CREDENTIALS` is `as const`, so TypeScript can already
 * prove two of the invariants below impossible and rejects the comparison as unintentional — which is a
 * stronger guarantee, and one this suite would lose the day someone drops the assertion. Widening here keeps
 * the runtime check standing underneath the static one.
 */
const REGISTER: readonly CredentialSpec[] = CREDENTIALS;

describe("the credential register", () => {
  it("names each store file exactly once", () => {
    const names = REGISTER.map((spec) => spec.name);

    expect(names.length).toBe(new Set(names).size);
  });

  it("keys every row by its own file name", () => {
    const byName = credentialsByName();

    expect(byName.size).toBe(REGISTER.length);
    expect(byName.get("linear-token")?.platform).toBe("Linear");
  });

  it("declares a reader for every live row, and none for a retired one", () => {
    const wrong = REGISTER.filter((spec) => (spec.lifecycle === "live") !== (spec.reader !== null)).map(
      (spec) => spec.name,
    );

    expect(wrong).toEqual([]);
  });

  it("never makes a retired name settable, so `secrets set` cannot mint fresh dead weight", () => {
    const settableRetired = REGISTER.filter((spec) => spec.settable && spec.lifecycle === "retired").map(
      (spec) => spec.name,
    );

    expect(settableRetired).toEqual([]);
  });

  it("never makes a grant file settable, because `normaliseSecretInput` rejects a multi-line value", () => {
    const settableGrants = REGISTER.filter((spec) => spec.settable && spec.shape === "grant").map((spec) => spec.name);

    expect(settableGrants).toEqual([]);
  });

  it("only records a `grant-cache` expiry for a grant-shaped credential", () => {
    const mismatched = REGISTER.filter((spec) => (spec.expiry === "grant-cache") !== (spec.shape === "grant")).map(
      (spec) => spec.name,
    );

    expect(mismatched).toEqual([]);
  });
});

describe("what the secret-absent monitor reads off it", () => {
  const liveSettable = REGISTER.filter((spec) => spec.lifecycle === "live" && spec.settable);
  const linking = REGISTER.filter((spec) => spec.absentMattersWith !== undefined);

  it("has live settable rows and at least one declared link, so the guards below are true of something", () => {
    expect([liveSettable.length > 0, linking.length > 0]).toEqual([true, true]);
  });

  it("writes every live settable row with exactly `slopweaver secrets set <name>`, the paste the card carries", () => {
    const other = liveSettable.filter((spec) => spec.writtenBy !== `slopweaver secrets set ${spec.name}`);

    expect(other.map((spec) => spec.name)).toEqual([]);
  });

  it("links only to rows that exist and are live", () => {
    const byName = credentialsByName();
    // `linking` holds only rows that declare the field, so the assertion is honest.
    const dangling = linking.flatMap((spec) =>
      spec
        .absentMattersWith!.filter((name) => byName.get(name)?.lifecycle !== "live")
        .map((name) => `${spec.name} → ${name}`),
    );

    expect(dangling).toEqual([]);
  });

  it("declares the links and the one optional row this install relies on", () => {
    expect([
      REGISTER.filter((spec) => spec.absentMattersWith !== undefined).map((spec) => [
        spec.name,
        spec.absentMattersWith,
      ]),
      REGISTER.filter((spec) => spec.optional === true).map((spec) => spec.name),
    ]).toEqual([
      [
        ["outlook-client-id", ["outlook-oauth.json", "outlook-calendar-oauth.json"]],
        ["backup-passphrase", ["store-backup-directory"]],
      ],
      ["jumpcloud-org-id"],
    ]);
  });
});

describe("the allowlist derived from it", () => {
  it("is exactly the settable rows, in register order", () => {
    expect(SECRET_NAMES).toEqual(REGISTER.filter((spec) => spec.settable).map((spec) => spec.name));
  });

  it("is the exact 43 settable names, and `SecretName` is exactly their union", () => {
    expectTypeOf<SecretName>().toEqualTypeOf<(typeof EXPECTED_SECRET_NAMES)[number]>();
    expect(SECRET_NAMES).toEqual(EXPECTED_SECRET_NAMES);
  });

  it("carries the three names the store held that `secrets set` used to refuse", () => {
    expect(SECRET_NAMES).toContain("jumpcloud-api-key");
    expect(SECRET_NAMES).toContain("jumpcloud-org-id");
    expect(SECRET_NAMES).toContain("playwright-extension-token");
  });

  it("excludes the retired Google client names, which nothing reads", () => {
    expect(SECRET_NAMES).not.toContain("gmail-client-id");
    expect(SECRET_NAMES).not.toContain("gmail-client-secret");
  });
});
