import { describe, expect, it } from "vitest";

import { VantaCredentialErrors, vantaCredentialErrorLines } from "../../../../atlas/vanta/credentialErrors.js";

describe("VantaCredentialErrors", () => {
  it("names both routes for an unset credential that has a store file", () => {
    const error = VantaCredentialErrors.credentialUnset({ name: "VANTA_CLIENT_ID", secretName: "vanta-client-id" });
    expect(error.code).toBe("CREDENTIAL_UNSET");
    expect(vantaCredentialErrorLines({ error })).toEqual([
      "VANTA_CLIENT_ID is not set — export it, or run: slopweaver secrets set vanta-client-id (Settings → Developer Console → your Manage Vanta application)",
    ]);
  });

  it("names only the environment route when a variable has no store file", () => {
    const error = VantaCredentialErrors.credentialUnset({ name: "VANTA_CLIENT_ID", secretName: undefined });
    expect(error.code).toBe("CREDENTIAL_UNSET");
    expect(error.message).toBe(
      "VANTA_CLIENT_ID is not set — export it (Settings → Developer Console → your Manage Vanta application)",
    );
  });

  it("names an implausible credential by its length and a whitespace one by its name, never a value", () => {
    const length = VantaCredentialErrors.credentialImplausibleLength({ length: 5, name: "VANTA_CLIENT_SECRET" });
    expect(length.code).toBe("CREDENTIAL_IMPLAUSIBLE_LENGTH");
    expect(length.message).toBe(
      "VANTA_CLIENT_SECRET is set (5 chars) but is not a plausible credential length — re-issue it rather than editing it",
    );
    const whitespace = VantaCredentialErrors.credentialHasWhitespace({ name: "VANTA_CLIENT_ID" });
    expect(whitespace.code).toBe("CREDENTIAL_HAS_WHITESPACE");
    expect(whitespace.message).toBe(
      "VANTA_CLIENT_ID is set but contains whitespace, which is not part of any credential Vanta issues — re-copy it",
    );
  });

  it("refuses an unpaired file flag and a half-populated store", () => {
    const unpaired = VantaCredentialErrors.credentialFilesUnpaired();
    expect(unpaired.code).toBe("CREDENTIAL_FILES_UNPAIRED");
    expect(unpaired.message).toBe("--client-id-file and --client-secret-file must be supplied together");
    const half = VantaCredentialErrors.storeHalfPopulated({
      missing: "vanta-client-secret",
      present: "vanta-client-id",
    });
    expect(half.code).toBe("CREDENTIAL_STORE_HALF_POPULATED");
    expect(half.message).toBe(
      "the secrets store holds vanta-client-id but not vanta-client-secret — the pair mints together, so run: slopweaver secrets set vanta-client-secret",
    );
  });

  it("names a credential file by its label and path on each file refusal", () => {
    const notRegular = VantaCredentialErrors.fileNotRegular({ label: "--client-id-file", path: "/tmp/x" });
    expect(notRegular.code).toBe("CREDENTIAL_FILE_NOT_REGULAR");
    expect(notRegular.message).toBe("--client-id-file does not name a regular file: /tmp/x");
    const loose = VantaCredentialErrors.fileNotOwnerOnly({ label: "--client-id-file", path: "/tmp/x" });
    expect(loose.code).toBe("CREDENTIAL_FILE_NOT_OWNER_ONLY");
    expect(loose.message).toBe("--client-id-file must be owner-only (mode 0600 or stricter): /tmp/x");
    const unreadable = VantaCredentialErrors.fileUnreadable({
      cause: new Error("ENOENT: no such file"),
      label: "--client-id-file",
      path: "/tmp/x",
    });
    expect(unreadable.code).toBe("CREDENTIAL_FILE_UNREADABLE");
    expect(unreadable.message).toBe("could not read --client-id-file at /tmp/x: ENOENT: no such file");
  });

  it("prints an unset slug as its two lines, joined for its message", () => {
    const error = VantaCredentialErrors.tenantSlugUnset({
      envName: "VANTA_TENANT_SLUG",
      secretName: "vanta-tenant-slug",
    });
    expect(error.code).toBe("TENANT_SLUG_UNSET");
    expect(vantaCredentialErrorLines({ error })).toEqual([
      "VANTA_TENANT_SLUG is not set — export it, pass --tenant, or run: slopweaver secrets set vanta-tenant-slug",
      "the slug is the single path segment after /c/ in your app.vanta.com URL",
    ]);
    expect(error.message).toBe(
      "VANTA_TENANT_SLUG is not set — export it, pass --tenant, or run: slopweaver secrets set vanta-tenant-slug; the slug is the single path segment after /c/ in your app.vanta.com URL",
    );
  });

  it("names the route of an empty, malformed or unreadable slug", () => {
    const empty = VantaCredentialErrors.tenantSlugEmpty({ route: "--tenant" });
    expect(empty.code).toBe("TENANT_SLUG_EMPTY");
    expect(empty.message).toBe(
      "--tenant is set but empty — it must be the workspace segment of your app.vanta.com URL",
    );
    const malformed = VantaCredentialErrors.tenantSlugMalformed({ route: "VANTA_TENANT_SLUG" });
    expect(malformed.code).toBe("TENANT_SLUG_MALFORMED");
    expect(malformed.message).toBe(
      "VANTA_TENANT_SLUG is not a Vanta workspace slug — it is the single path segment after /c/ in your app.vanta.com URL",
    );
    const unreadable = VantaCredentialErrors.tenantSlugUnreadable({
      cause: new Error("EACCES: permission denied"),
      path: "/tmp/x",
      secretName: "vanta-tenant-slug",
    });
    expect(unreadable.code).toBe("TENANT_SLUG_UNREADABLE");
    expect(vantaCredentialErrorLines({ error: unreadable })).toEqual([
      "could not read secrets/vanta-tenant-slug at /tmp/x: EACCES: permission denied",
    ]);
  });

  it("quotes the operation lock's own words when the mint lock is held", () => {
    const error = VantaCredentialErrors.mintLockHeld({ holder: "held by pid 42" });
    expect(error.code).toBe("MINT_LOCK_HELD");
    expect(error.message).toBe("could not acquire the Vanta token mint lock: held by pid 42");
  });
});
