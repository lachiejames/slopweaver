/**
 * Unit: the shared Google grant store, round-tripped through a real temp directory (a genuine fixture, not a
 * mock — `testing.md` permits filesystem for exactly this).
 *
 * Driven through the mail door's REAL bound store rather than a synthetic one, so the file mode, the
 * corruption refusals and the token-free status are asserted of the thing that actually ships. The Drive
 * door's binding is asserted separately to be a DIFFERENT file, which is the property that keeps revoking
 * one door from touching the other.
 */
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { driveGrantStore } from "../../../secrets/driveGrant.js";
import { type GmailGrant, gmailGrantStore } from "../../../secrets/gmailGrant.js";
import { googleGrantStore } from "../../../secrets/googleGrant.js";

const GRANT: GmailGrant = {
  account: "me@example.test",
  accessToken: "ya29-ACCESS-TOKEN-MATERIAL",
  expiryMs: 1_756_300_000_000,
  grantedAtIso: "2026-08-27T12:00:00.000Z",
  refreshToken: "1//REFRESH-TOKEN-MATERIAL",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
};

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-google-grant-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("googleGrantStore write / read", () => {
  it("round-trips a grant through the secrets directory", () => {
    const dir = home();
    const path = unwrap(gmailGrantStore.write({ grant: GRANT, home: dir }));
    expect(path).toBe(gmailGrantStore.path({ home: dir }));
    expect(unwrap(gmailGrantStore.read({ home: dir }))).toStrictEqual(GRANT);
  });

  it("writes the grant owner-only, because it holds a long-lived mailbox credential", () => {
    const dir = home();
    const path = unwrap(gmailGrantStore.write({ grant: GRANT, home: dir }));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("re-tightens the mode when overwriting a grant left world-readable", () => {
    const dir = home();
    const path = unwrap(gmailGrantStore.write({ grant: GRANT, home: dir }));
    chmodSync(path, 0o644);
    unwrap(gmailGrantStore.write({ grant: { ...GRANT, accessToken: "ya29-SECOND" }, home: dir }));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("reports NO grant as undefined rather than as an error — not connected is an ordinary state", () => {
    expect(unwrap(gmailGrantStore.read({ home: home() }))).toBe(undefined);
  });

  it("reports a corrupt grant as an ERROR, because that is damage rather than absence", () => {
    const dir = home();
    unwrap(gmailGrantStore.write({ grant: GRANT, home: dir }));
    writeFileSync(gmailGrantStore.path({ home: dir }), "{not json", { mode: 0o600 });
    const read = gmailGrantStore.read({ home: dir });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read)[0]).toContain("not valid JSON");
  });

  it("refuses a grant file missing the refresh token, which would fail silently an hour later", () => {
    const dir = home();
    unwrap(gmailGrantStore.write({ grant: GRANT, home: dir }));
    writeFileSync(
      gmailGrantStore.path({ home: dir }),
      JSON.stringify({ account: "a", grantedAtIso: "x", scopes: [] }),
      {
        mode: 0o600,
      },
    );
    const read = gmailGrantStore.read({ home: dir });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read)[0]).toContain("refreshToken");
  });
});

describe("googleGrantStore status", () => {
  it("carries the account, scopes and path and NO token material", () => {
    const status = gmailGrantStore.status({ grant: GRANT, home: "/tmp/example-home" });
    expect(status.account).toBe("me@example.test");
    expect(status.scopes).toStrictEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
    expect(status.grantedAtIso).toBe("2026-08-27T12:00:00.000Z");
    expect(JSON.stringify(status).includes("REFRESH-TOKEN-MATERIAL")).toBe(false);
    expect(JSON.stringify(status).includes("ACCESS-TOKEN-MATERIAL")).toBe(false);
  });

  it("carries the refresh-token lapse only when the grant recorded one", () => {
    const lapsing = { ...GRANT, refreshTokenExpiresAtIso: "2026-09-03T12:00:00.000Z" };
    expect(gmailGrantStore.status({ grant: lapsing, home: "/h" }).refreshTokenExpiresAtIso).toBe(
      "2026-09-03T12:00:00.000Z",
    );
    expect(Object.keys(gmailGrantStore.status({ grant: GRANT, home: "/h" }))).not.toContain("refreshTokenExpiresAtIso");
  });
});

describe("googleGrantStore refresh-token lapse", () => {
  it("round-trips a grant carrying its refresh-token lapse", () => {
    const dir = home();
    const lapsing = { ...GRANT, refreshTokenExpiresAtIso: "2026-09-03T12:00:00.000Z" };
    unwrap(gmailGrantStore.write({ grant: lapsing, home: dir }));
    expect(unwrap(gmailGrantStore.read({ home: dir }))).toStrictEqual(lapsing);
  });

  it.each([
    ["a number", 1_756_900_000_000],
    ["text that is no instant", "next week"],
  ])("refuses a stored lapse that is %s, rather than reading it as a grant that never lapses", (_label, lapse) => {
    const dir = home();
    unwrap(gmailGrantStore.write({ grant: GRANT, home: dir }));
    writeFileSync(gmailGrantStore.path({ home: dir }), JSON.stringify({ ...GRANT, refreshTokenExpiresAtIso: lapse }), {
      mode: 0o600,
    });
    expect(unwrapErr(gmailGrantStore.read({ home: dir }))[0]).toContain("holds a field of the wrong shape");
  });
});

describe("one store per door", () => {
  it("binds the two doors to DIFFERENT files, so revoking one cannot touch the other", () => {
    const dir = home();
    expect(gmailGrantStore.path({ home: dir })).not.toBe(driveGrantStore.path({ home: dir }));
    expect(gmailGrantStore.path({ home: dir }).endsWith("gmail-oauth.json")).toBe(true);
    expect(driveGrantStore.path({ home: dir }).endsWith("drive-oauth.json")).toBe(true);
  });

  it("names its own door in a corruption message, so a reader is told which grant to re-establish", () => {
    const dir = home();
    unwrap(driveGrantStore.write({ grant: GRANT, home: dir }));
    writeFileSync(driveGrantStore.path({ home: dir }), "{not json", { mode: 0o600 });
    expect(unwrapErr(driveGrantStore.read({ home: dir }))[0]).toContain("Google Drive");
  });
});

describe("googleGrantStore", () => {
  // A door of its own, bound here rather than borrowed, so what is asserted is the FACTORY threading a door's
  // filename, product name and connect verb into every member — not one shipped binding's constants.
  const store = googleGrantStore({
    connectVerb: "slopweaver example connect",
    productName: "Example Door",
    secretName: "example-oauth.json",
  });

  it("puts the bound filename under the home's secrets directory", () => {
    const dir = home();
    expect(store.path({ home: dir })).toBe(join(dir, "secrets", "example-oauth.json"));
  });

  it("names the bound product and connect verb when a stored grant has the wrong shape", () => {
    const dir = home();
    unwrap(store.write({ grant: GRANT, home: dir }));
    writeFileSync(store.path({ home: dir }), JSON.stringify({ account: "me@example.test" }), { mode: 0o600 });
    expect(unwrapErr(store.read({ home: dir }))).toStrictEqual([
      "the stored Example Door grant is missing account, scopes or refreshToken, or holds a field of the wrong shape — re-run `slopweaver example connect`",
    ]);
  });

  it("removes the bound file and returns its path, then refuses a second removal naming the product", () => {
    const dir = home();
    const path = unwrap(store.write({ grant: GRANT, home: dir }));
    expect(unwrap(store.remove({ home: dir }))).toBe(path);
    expect(unwrap(store.read({ home: dir }))).toBe(undefined);
    expect(unwrapErr(store.remove({ home: dir }))[0]).toContain("Example Door");
  });
});
