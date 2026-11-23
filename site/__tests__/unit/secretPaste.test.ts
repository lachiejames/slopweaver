/*
 * A secret pasted into the console: the checks before anything launches, the argv and stdin it launches
 * with, the receipt it answers with, and the two readers the field's receipt stands on.
 *
 * Onboarding has the owner paste secrets into the console instead of working out which commands to run. The property every case below guards: the value is in the stdin
 * payload and nowhere else — not the argv, not a refusal, not a receipt.
 */

import { describe, expect, it } from "vitest";

import { readHandSteps } from "../../components/live/read";
import { readSecretStatus, readSecretStore } from "../../components/live/readSecrets";
import {
  SECRET_VALUE_MAX,
  secretFieldReceipt,
  secretPasteRequest,
  secretReceipt,
  secretSetArgv,
  secretStdin,
} from "../../lib/secretPaste";

/** A value distinctive enough that finding it anywhere is the leak, not a coincidence. */
const VALUE = "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secret";

/** Every way a paste can be refused, each carrying {@link VALUE} where it can, so a refusal that echoes it is caught. */
const REFUSED_BODIES: readonly unknown[] = [
  [VALUE],
  { name: "google-secops-client-secret", value: VALUE, extra: VALUE },
  { name: "../google-secops-client-secret", value: VALUE },
  { name: "--home", value: VALUE },
  { name: "Google-Client", value: VALUE },
  { name: "google-client-secret", value: `${VALUE}${"x".repeat(SECRET_VALUE_MAX)}` },
  { name: "google-client-secret", value: "   " },
  { name: "google-client-secret", value: 42 },
];

describe("secretPasteRequest", () => {
  it("passes exactly a name of a store file's shape and a non-empty value", () => {
    expect(secretPasteRequest({ body: { name: "google-secops-client-secret", value: VALUE } })).toEqual({
      kind: "ok",
      name: "google-secops-client-secret",
      value: VALUE,
    });
  });

  it("passes a dotted store name, which a grant-shaped row carries", () => {
    expect(secretPasteRequest({ body: { name: "store-backup-directory", value: VALUE } }).kind).toBe("ok");
  });

  it("refuses every bad shape, and no refusal carries the value it was handed", () => {
    expect(REFUSED_BODIES.length).toBeGreaterThan(0);
    const verdicts = REFUSED_BODIES.map((body) => secretPasteRequest({ body }));
    expect(verdicts.map((verdict) => verdict.kind)).toEqual(REFUSED_BODIES.map(() => "refused"));
    expect(JSON.stringify(REFUSED_BODIES)).toContain(VALUE);
    expect(JSON.stringify(verdicts)).not.toContain(VALUE);
  });

  it("names the extra key a body carried", () => {
    expect(secretPasteRequest({ body: { name: "linear-token", value: VALUE, home: "/tmp" } })).toEqual({
      kind: "refused",
      why: "the body carries home; a paste carries only a name and a value",
    });
  });

  it("refuses a traversal or a flag as a name, so neither reaches the argv", () => {
    expect(secretPasteRequest({ body: { name: "../x", value: VALUE } })).toEqual({
      kind: "refused",
      why: "the name is not a secret's name: lowercase words joined by -, . or _",
    });
    expect(secretPasteRequest({ body: { name: "a..b", value: VALUE } }).kind).toBe("refused");
    expect(secretPasteRequest({ body: { name: "--stdin", value: VALUE } }).kind).toBe("refused");
  });
});

describe("what the paste launches with", () => {
  it("puts the name in the argv and the value nowhere in it", () => {
    const argv = secretSetArgv({ name: "linear-token" });
    expect(argv).toEqual(["secrets", "set", "linear-token", "--stdin", "--json"]);
    expect(argv.join(" ")).not.toContain(VALUE);
  });

  it("pipes the value with one trailing newline, adding none to one that has it", () => {
    expect(secretStdin({ value: VALUE })).toBe(`${VALUE}\n`);
    expect(secretStdin({ value: `${VALUE}\n` })).toBe(`${VALUE}\n`);
  });
});

describe("secretReceipt", () => {
  it("reads the verb's JSON line into the name and path", () => {
    const out = '{"name":"linear-token","ok":true,"path":"/h/secrets/linear-token"}\n';
    expect(secretReceipt({ name: "linear-token", out })).toEqual({
      name: "linear-token",
      path: "/h/secrets/linear-token",
    });
  });

  it("reads nothing from a line naming another secret, or from no line at all", () => {
    expect(
      secretReceipt({ name: "linear-token", out: '{"name":"notion-token","ok":true,"path":"/p"}' }),
    ).toBeUndefined();
    expect(secretReceipt({ name: "linear-token", out: "set linear-token (0600) → /p" })).toBeUndefined();
  });
});

describe("secretFieldReceipt", () => {
  const STORED = [{ modifiedIso: "2026-10-02T11:50:25.832Z", name: "google-secops-client-secret", stored: true }];

  it("says this page's own press first, over a store reading taken before it", () => {
    expect(
      secretFieldReceipt({
        name: "google-secops-client-secret",
        pressedIso: "2026-10-02T12:30:00.000Z",
        status: STORED,
      }),
    ).toEqual({ atIso: "2026-10-02T12:30:00.000Z", kind: "set", name: "google-secops-client-secret" });
  });

  it("says stored, with when, after a reload", () => {
    expect(secretFieldReceipt({ name: "google-secops-client-secret", pressedIso: undefined, status: STORED })).toEqual({
      kind: "stored",
      modifiedIso: "2026-10-02T11:50:25.832Z",
      name: "google-secops-client-secret",
    });
  });

  it("says not set for a name the store lacks or holds unstored", () => {
    expect(secretFieldReceipt({ name: "linear-token", pressedIso: undefined, status: STORED }).kind).toBe("unset");
    const absent = [{ modifiedIso: undefined, name: "linear-token", stored: false }];
    expect(secretFieldReceipt({ name: "linear-token", pressedIso: undefined, status: absent }).kind).toBe("unset");
  });

  it("says unread rather than not set while the store has not been read", () => {
    expect(secretFieldReceipt({ name: "linear-token", pressedIso: undefined, status: undefined }).kind).toBe("unread");
  });
});

describe("readSecretStatus", () => {
  it("keeps only what a receipt draws", () => {
    const payload = {
      home: "/h",
      rows: [
        {
          modeOctal: "600",
          modifiedIso: "2026-10-02T11:50:25.832Z",
          name: "linear-token",
          state: "ok",
          stored: true,
          what: "a key",
        },
        { name: "notion-token", state: "absent", stored: false, what: "a token" },
      ],
    };
    expect(readSecretStatus(payload)).toEqual([
      { modifiedIso: "2026-10-02T11:50:25.832Z", name: "linear-token", state: "ok", stored: true, what: "a key" },
      { modifiedIso: undefined, name: "notion-token", state: "absent", stored: false, what: "a token" },
    ]);
  });

  it("refuses a payload that is not the verb's shape rather than read it as nothing stored", () => {
    expect(readSecretStatus({ rows: [{ name: "linear-token" }] })).toBeUndefined();
    expect(readSecretStatus({ rows: [{ name: "linear-token", stored: true }] })).toBeUndefined();
    expect(readSecretStatus([])).toBeUndefined();
  });
});

describe("readSecretStore", () => {
  const rows = [{ name: "datadog-app-key", state: "ok", stored: true }];

  it("carries the verb's Datadog site verdict beside the rows", () => {
    expect(readSecretStore({ datadogSite: "unset", home: "/h", rows })).toEqual({
      datadogSite: "unset",
      rows: [{ modifiedIso: undefined, name: "datadog-app-key", state: "ok", stored: true, what: undefined }],
    });
  });

  it("refuses a document with no site verdict, or with rows that are not the verb's, rather than guess either", () => {
    expect(readSecretStore({ home: "/h", rows })).toBeUndefined();
    expect(readSecretStore({ datadogSite: "set", rows: [{ name: "datadog-app-key" }] })).toBeUndefined();
  });

  it("refuses a site verdict that is not one of set, unset or invalid, so no other bytes ride that field", () => {
    expect(
      [
        readSecretStore({ datadogSite: "set", rows }),
        readSecretStore({ datadogSite: "invalid", rows }),
        readSecretStore({ datadogSite: "1//REFRESH-TOKEN-FIXTURE", rows }),
        readSecretStore({ datadogSite: "datadoghq.com", rows }),
      ].map((reading) => reading?.datadogSite),
    ).toEqual(["set", "invalid", undefined, undefined]);
  });

  it("keeps a state shaped like the verb's words, a future one included, and refuses any other", () => {
    const withState = ({ state }: { state: string }): readonly string[] | undefined =>
      readSecretStatus({ rows: [{ name: "gmail-oauth.json", state, stored: true }] })?.map((row) => row.state);
    expect(
      ["ok", "write-scope-on-read-only", "some-future-finding", "1//REFRESH-TOKEN-FIXTURE", "Ok", ""].map((state) =>
        withState({ state }),
      ),
    ).toEqual([["ok"], ["write-scope-on-read-only"], ["some-future-finding"], undefined, undefined, undefined]);
  });
});

describe("a hand step's secrets reach the card", () => {
  const STEP = {
    id: "secops-oauth-client",
    postedIso: "2026-10-02T06:55:34.641Z",
    what: "Create the SecOps OAuth client, then paste its id and secret",
  };

  it("reads the names the register publishes", () => {
    const steps = readHandSteps([{ ...STEP, secrets: ["google-secops-client-id", "google-secops-client-secret"] }])!;
    expect(steps[0].secrets).toEqual(["google-secops-client-id", "google-secops-client-secret"]);
  });

  it("reads none on a row from before the field", () => {
    expect(readHandSteps([STEP])![0].secrets).toEqual([]);
  });

  it("draws the step as unreadable, naming secrets, when the field is present and not a list of names", () => {
    expect(readHandSteps([{ ...STEP, secrets: "google-secops-client-id" }])![0].unreadable).toBe("secrets");
    expect(readHandSteps([{ ...STEP, secrets: [42] }])![0].unreadable).toBe("secrets");
  });
});
