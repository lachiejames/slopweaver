/**
 * Unit: resolving the Make token and zone from a throwaway secrets store — both present, either absent,
 * an empty file, and a zone this atlas does not address.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MAKE_TOKEN_SECRET, MAKE_ZONE_SECRET, resolveMakeCredential } from "../../../../atlas/make/credential.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("resolveMakeCredential", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A home whose secrets directory holds exactly these files. */
  function homeWith({ files }: { files: Readonly<Record<string, string>> }): string {
    const home = mkdtempSync(join(tmpdir(), "make-credential-"));
    homes.push(home);
    mkdirSync(join(home, "secrets"), { mode: 0o700 });
    for (const [name, value] of Object.entries(files)) {
      writeFileSync(join(home, "secrets", name), value, { mode: 0o600 });
    }
    return home;
  }

  it("resolves the token and zone, trimmed", () => {
    const home = homeWith({ files: { [MAKE_TOKEN_SECRET]: "tok-123\n", [MAKE_ZONE_SECRET]: " eu2.make.com\n" } });
    expect(unwrap(resolveMakeCredential({ home }))).toStrictEqual({ token: "tok-123", zone: "eu2.make.com" });
  });

  it("names both secrets when neither is set, with where the token is minted", () => {
    const failure = unwrapErr(resolveMakeCredential({ home: homeWith({ files: {} }) }));
    expect(failure.code).toBe("CREDENTIAL_MISSING");
    expect(failure.message).toContain("absent from the secrets store: make-api-token, make-zone");
    expect(failure.message).toContain("avatar → Profile → API → Add token");
  });

  it("names only the zone when the token alone is set", () => {
    const failure = unwrapErr(resolveMakeCredential({ home: homeWith({ files: { [MAKE_TOKEN_SECRET]: "tok" } }) }));
    expect(failure.message).toContain("absent from the secrets store: make-zone.");
  });

  it("refuses an empty token file as unreadable rather than missing", () => {
    const home = homeWith({ files: { [MAKE_TOKEN_SECRET]: "  \n", [MAKE_ZONE_SECRET]: "eu2.make.com" } });
    const failure = unwrapErr(resolveMakeCredential({ home }));
    expect(failure.code).toBe("CREDENTIAL_UNREADABLE");
    expect(failure.message).toBe(
      "could not use the make-api-token secret: the file is empty; check it with `slopweaver secrets status`",
    );
  });

  it("names an unreadable file by its secret name and fs code, never the state home's path", () => {
    const home = homeWith({ files: { [MAKE_TOKEN_SECRET]: "tok" } });
    mkdirSync(join(home, "secrets", MAKE_ZONE_SECRET));
    const failure = unwrapErr(resolveMakeCredential({ home }));
    expect(failure.code).toBe("CREDENTIAL_UNREADABLE");
    expect(failure.message).toBe(
      "could not use the make-zone secret: it could not be read (EISDIR); check it with `slopweaver secrets status`",
    );
    expect(home.length).toBeGreaterThan(0);
    expect(failure.message).not.toContain(home);
  });

  it("refuses a zone off the published set, so the token is never sent to another host", () => {
    const home = homeWith({ files: { [MAKE_TOKEN_SECRET]: "tok", [MAKE_ZONE_SECRET]: "make.example.org" } });
    const failure = unwrapErr(resolveMakeCredential({ home }));
    expect(failure.code).toBe("ZONE_NOT_ALLOWED");
    expect(failure.message).toContain("the make-zone secret is not a Make zone this atlas addresses");
  });

  it("never prints what the zone file held, since a token pasted into it would otherwise reach stderr", () => {
    const home = homeWith({ files: { [MAKE_TOKEN_SECRET]: "SECRET-TOKEN", [MAKE_ZONE_SECRET]: "SECRET-TOKEN" } });
    const failure = unwrapErr(resolveMakeCredential({ home }));
    expect(failure.code).toBe("ZONE_NOT_ALLOWED");
    expect(failure.message).toContain("its value is not printed");
    expect(failure.message).not.toContain("SECRET-TOKEN");
  });
});
