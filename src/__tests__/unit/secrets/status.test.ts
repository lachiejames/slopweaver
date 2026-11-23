/**
 * The state machine behind `slopweaver secrets status`.
 *
 * Every state is asserted with a witness that FIRES — the point of this verb is that four states stood
 * unnoticed for a fortnight, so a test suite that only ever produced `ok` would reproduce the original
 * defect one level up. `nowMs` is a stated instant rather than the wall clock, so the expiry assertions are
 * about the comparison rather than about when the suite happens to run.
 */
import { describe, expect, it } from "vitest";

import { CREDENTIALS, type CredentialSpec } from "../../../secrets/registry.js";
import { credentialRows, credentialState, isFinding, type StoreObservation } from "../../../secrets/status.js";

/** A stated instant, so every expiry assertion is about the comparison and never about the clock. */
const NOW_MS = 1_788_800_000_000;

const LINE_SPEC: CredentialSpec = {
  expiry: "none",
  lifecycle: "live",
  mintScope: "read-only",
  name: "test-line-token",
  platform: "TestCo",
  reader: "src/config.ts",
  readVerbs: "slopweaver test *",
  settable: true,
  shape: "line",
  usedFor: "reading TestCo",
  what: "a test token",
  writtenBy: "slopweaver secrets set test-line-token",
};

const GRANT_SPEC: CredentialSpec = {
  expiry: "grant-cache",
  lifecycle: "live",
  mintScope: "read-only",
  name: "test-oauth.json",
  platform: "TestCo (door)",
  reader: "src/secrets/gmailGrant.ts",
  readVerbs: "slopweaver test *",
  settable: false,
  shape: "grant",
  usedFor: "acting as the bound account",
  what: "a user-consent grant",
  writtenBy: "slopweaver test connect",
};

const RETIRED_SPEC: CredentialSpec = {
  expiry: "none",
  lifecycle: "retired",
  mintScope: "not-a-credential",
  name: "test-old-token",
  platform: "TestCo",
  reader: null,
  readVerbs: "nothing",
  settable: false,
  shape: "line",
  usedFor: "NOTHING",
  what: "a superseded token",
  writtenBy: "placed by hand",
};

const tightLine = ({ name }: { name: string }): StoreObservation => ({
  modeOctal: "600",
  modifiedIso: "2026-09-01T00:00:00.000Z",
  name,
});

describe("credentialState", () => {
  it("reports `absent` for a declared credential with no file", () => {
    expect(credentialState({ nowMs: NOW_MS, observed: undefined, spec: LINE_SPEC })).toBe("absent");
  });

  it("reports `ok` for a stored 0600 single-line secret", () => {
    expect(credentialState({ nowMs: NOW_MS, observed: tightLine({ name: LINE_SPEC.name }), spec: LINE_SPEC })).toBe(
      "ok",
    );
  });

  it("reports `empty`, a finding, for a stored 0600 single-line secret of zero bytes", () => {
    expect(
      credentialState({
        nowMs: NOW_MS,
        observed: { ...tightLine({ name: LINE_SPEC.name }), empty: true },
        spec: LINE_SPEC,
      }),
    ).toBe("empty");
    expect(isFinding({ state: "empty" })).toBe(true);
  });

  it("reports `dead` for a stored file nothing reads", () => {
    expect(
      credentialState({ nowMs: NOW_MS, observed: tightLine({ name: RETIRED_SPEC.name }), spec: RETIRED_SPEC }),
    ).toBe("dead");
  });

  it("reports `loose-mode` when the owner is not alone in being able to read it", () => {
    expect(
      credentialState({
        nowMs: NOW_MS,
        observed: { modeOctal: "644", modifiedIso: "2026-09-01T00:00:00.000Z", name: LINE_SPEC.name },
        spec: LINE_SPEC,
      }),
    ).toBe("loose-mode");
  });

  it("reports `grant-unreadable`, a finding, for a stored 0600 grant file that did not parse", () => {
    expect(credentialState({ nowMs: NOW_MS, observed: tightLine({ name: GRANT_SPEC.name }), spec: GRANT_SPEC })).toBe(
      "grant-unreadable",
    );
    expect(isFinding({ state: "grant-unreadable" })).toBe(true);
  });

  it("reports `expiry-unrecorded` for a grant carrying no expiryMs at all", () => {
    expect(
      credentialState({
        nowMs: NOW_MS,
        observed: {
          grant: { account: "a@b.c", grantedAtIso: "2026-09-01T00:00:00.000Z", scopeCount: 3, writeScopes: [] },
          modeOctal: "600",
          modifiedIso: "2026-09-01T00:00:00.000Z",
          name: GRANT_SPEC.name,
        },
        spec: GRANT_SPEC,
      }),
    ).toBe("expiry-unrecorded");
  });

  it("reports `access-token-expired` for a grant whose cached expiry has passed", () => {
    expect(
      credentialState({
        nowMs: NOW_MS,
        observed: {
          grant: {
            account: "a@b.c",
            expiryMs: NOW_MS - 1,
            grantedAtIso: "2026-09-01T00:00:00.000Z",
            scopeCount: 3,
            writeScopes: [],
          },
          modeOctal: "600",
          modifiedIso: "2026-09-01T00:00:00.000Z",
          name: GRANT_SPEC.name,
        },
        spec: GRANT_SPEC,
      }),
    ).toBe("access-token-expired");
  });

  it("reports `ok` for a grant whose cached expiry is still ahead", () => {
    expect(
      credentialState({
        nowMs: NOW_MS,
        observed: {
          grant: {
            account: "a@b.c",
            expiryMs: NOW_MS + 1,
            grantedAtIso: "2026-09-01T00:00:00.000Z",
            scopeCount: 3,
            writeScopes: [],
          },
          modeOctal: "600",
          modifiedIso: "2026-09-01T00:00:00.000Z",
          name: GRANT_SPEC.name,
        },
        spec: GRANT_SPEC,
      }),
    ).toBe("ok");
  });

  it("treats an expiry exactly at `now` as expired, so the boundary is not a silent pass", () => {
    expect(
      credentialState({
        nowMs: NOW_MS,
        observed: {
          grant: {
            account: "a@b.c",
            expiryMs: NOW_MS,
            grantedAtIso: "2026-09-01T00:00:00.000Z",
            scopeCount: 3,
            writeScopes: [],
          },
          modeOctal: "600",
          modifiedIso: "2026-09-01T00:00:00.000Z",
          name: GRANT_SPEC.name,
        },
        spec: GRANT_SPEC,
      }),
    ).toBe("access-token-expired");
  });
});

describe("a declared read-only grant carrying a write scope", () => {
  const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
  const adminGrant = ({ writeScopes }: { writeScopes: readonly string[] }): StoreObservation => ({
    grant: {
      account: "admin@example.test",
      expiryMs: NOW_MS + 1,
      grantedAtIso: "2026-09-06T08:33:38.735Z",
      scopeCount: 33,
      writeScopes,
    },
    modeOctal: "600",
    modifiedIso: "2026-10-01T10:06:00.000Z",
    name: "google-admin-oauth.json",
  });

  it("is a finding over the REAL google-admin-oauth.json register row, and the label says read-write", () => {
    const rows = credentialRows({ nowMs: NOW_MS, observations: [adminGrant({ writeScopes: [GMAIL_SEND] })] });
    const admin = rows.find((row) => row.name === "google-admin-oauth.json")!;

    expect(CREDENTIALS.find((spec) => spec.name === "google-admin-oauth.json")!.mintScope).toBe("read-only");
    expect(admin.state).toBe("write-scope-on-read-only");
    expect(admin.mintScope).toBe("read-write");
    expect(admin.detail).toContain(`the grant on disk carries ${GMAIL_SEND}`);
    expect(isFinding({ state: admin.state })).toBe(true);
  });

  it("is ok, and labelled read-only from the disk, once the grant carries no write scope", () => {
    const rows = credentialRows({ nowMs: NOW_MS, observations: [adminGrant({ writeScopes: [] })] });
    const admin = rows.find((row) => row.name === "google-admin-oauth.json")!;

    expect(admin.state).toBe("ok");
    expect(admin.mintScope).toBe("read-only");
  });

  it("is not a finding on a grant the register declares read-write — the write is that door's point", () => {
    const rows = credentialRows({
      nowMs: NOW_MS,
      observations: [{ ...adminGrant({ writeScopes: [GMAIL_SEND] }), name: "gmail-oauth.json" }],
    });
    const gmail = rows.find((row) => row.name === "gmail-oauth.json")!;

    expect(gmail.state).toBe("ok");
    expect(gmail.mintScope).toBe("read-write");
  });

  it("outranks a stale access-token cache, being a posture problem rather than a note", () => {
    const observed = adminGrant({ writeScopes: [GMAIL_SEND] });
    const expired: StoreObservation = { ...observed, grant: { ...observed.grant!, expiryMs: NOW_MS - 1 } };

    expect(credentialState({ nowMs: NOW_MS, observed: expired, spec: GRANT_SPEC })).toBe("write-scope-on-read-only");
  });
});

describe("isFinding", () => {
  it("counts every state that needs a decision", () => {
    expect(isFinding({ state: "write-scope-on-read-only" })).toBe(true);
    expect(isFinding({ state: "off-allowlist" })).toBe(true);
    expect(isFinding({ state: "dead" })).toBe(true);
    expect(isFinding({ state: "access-token-expired" })).toBe(true);
    expect(isFinding({ state: "expiry-unrecorded" })).toBe(true);
    expect(isFinding({ state: "loose-mode" })).toBe(true);
  });

  it("counts neither of the two ordinary states", () => {
    expect(isFinding({ state: "ok" })).toBe(false);
    expect(isFinding({ state: "absent" })).toBe(false);
  });
});

describe("credentialRows", () => {
  const specs: readonly CredentialSpec[] = [LINE_SPEC, GRANT_SPEC, RETIRED_SPEC];

  it("reports an undeclared store file as `off-allowlist`, with everything unknown said as unknown", () => {
    const rows = credentialRows({
      nowMs: NOW_MS,
      observations: [tightLine({ name: "hand-placed-token" })],
      specs,
    });
    const stray = rows.find((row) => row.name === "hand-placed-token")!;

    expect(stray.state).toBe("off-allowlist");
    expect(stray.platform).toBe("unknown");
    expect(stray.reader).toBe(null);
    expect(stray.detail).toContain(
      "written from a checkout whose register carries its row, so `secrets set` here would refuse to rewrite it",
    );
  });

  it("tells an absent declared credential the verb that writes it", () => {
    const rows = credentialRows({ nowMs: NOW_MS, observations: [], specs });

    expect(rows.find((row) => row.name === LINE_SPEC.name)!.detail).toBe(
      "not stored — slopweaver secrets set test-line-token",
    );
  });

  it("keeps a retired credential whose file is already gone, so --all can read the register itself", () => {
    const rows = credentialRows({ nowMs: NOW_MS, observations: [], specs });

    expect(rows.map((row) => row.name)).toEqual([LINE_SPEC.name, GRANT_SPEC.name, RETIRED_SPEC.name]);
    expect(rows.find((row) => row.name === RETIRED_SPEC.name)!.state).toBe("absent");
    expect(rows.find((row) => row.name === RETIRED_SPEC.name)!.stored).toBe(false);
  });

  it("keeps a retired credential whose file is still there, so deleting it is someone's decision", () => {
    const rows = credentialRows({
      nowMs: NOW_MS,
      observations: [tightLine({ name: RETIRED_SPEC.name })],
      specs,
    });

    expect(rows.find((row) => row.name === RETIRED_SPEC.name)!.state).toBe("dead");
  });

  it("lists declared rows in register order, then strays in name order", () => {
    const rows = credentialRows({
      nowMs: NOW_MS,
      observations: [tightLine({ name: "zeta-token" }), tightLine({ name: "alpha-token" })],
      specs,
    });

    expect(rows.map((row) => row.name)).toEqual([
      LINE_SPEC.name,
      GRANT_SPEC.name,
      RETIRED_SPEC.name,
      "alpha-token",
      "zeta-token",
    ]);
  });

  it("renders a grant's expiry as an instant and never its token material", () => {
    const rows = credentialRows({
      nowMs: NOW_MS,
      observations: [
        {
          grant: {
            account: "a@b.c",
            expiryMs: 1_788_753_302_318,
            grantedAtIso: "2026-08-28T18:54:53.663Z",
            scopeCount: 7,
            writeScopes: [],
          },
          modeOctal: "600",
          modifiedIso: "2026-09-07T02:55:00.000Z",
          name: GRANT_SPEC.name,
        },
      ],
      specs,
    });
    const grantRow = rows.find((row) => row.name === GRANT_SPEC.name)!;

    expect(grantRow.expiryIso).toBe("2026-09-07T03:55:02.318Z");
    expect(grantRow.account).toBe("a@b.c");
    expect(Object.keys(grantRow).filter((key) => key.toLowerCase().includes("token"))).toEqual([]);
  });
});
