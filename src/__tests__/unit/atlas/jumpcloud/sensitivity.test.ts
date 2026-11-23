import { describe, expect, it } from "vitest";

import { projectJumpcloudValue } from "../../../../atlas/jumpcloud/projection.js";
import {
  admitJumpcloudGeneration,
  jumpcloudSensitivityHits,
  writtenValue,
} from "../../../../atlas/jumpcloud/sensitivity.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** An endpoint with no endpoint-scoped denial of its own, so these tests exercise the name rules alone. */
const ANY_ENDPOINT = "/api/systems";

describe("jumpcloudSensitivityHits", () => {
  it("passes a clean generation", () => {
    const document = { systems: [{ _id: "65a0", hostname: "host", fde: { keyPresent: true } }] };
    expect(jumpcloudSensitivityHits({ document })).toStrictEqual([]);
  });

  it("catches a denied field that reached the document despite the projection", () => {
    const hits = jumpcloudSensitivityHits({ document: { applications: [{ idpPrivateKey: "x" }] } });
    expect(hits.length).toBe(1);
    expect(hits[0]!.pointer).toBe("/applications/0/idpPrivateKey");
  });

  it("catches a PEM private key under a field name nobody anticipated", () => {
    const document = { policies: [{ notes: "-----BEGIN RSA PRIVATE KEY-----\nMIIE" }] };
    const hits = jumpcloudSensitivityHits({ document });
    expect(hits.length).toBe(1);
    expect(hits[0]!.finding).toBe("value matches PEM private key block");
  });

  it("catches a 40-hex JumpCloud API key pasted into a description", () => {
    const document = { commands: [{ description: "run with key 0123456789abcdef0123456789abcdef01234567" }] };
    expect(jumpcloudSensitivityHits({ document }).length).toBe(1);
  });

  it("catches a JWT in a nested array", () => {
    const document = {
      a: [{ b: ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1g"] }],
    };
    expect(jumpcloudSensitivityHits({ document }).length).toBe(1);
  });

  it("never quotes the offending value, so a refusal message is safe to print and log", () => {
    const secret = "-----BEGIN OPENSSH PRIVATE KEY-----";
    const hits = jumpcloudSensitivityHits({ document: { x: secret } });
    expect(hits[0]!.finding.includes(secret)).toBe(false);
  });

  it("reports every hit rather than stopping at the first, so one publish names all of them", () => {
    const document = { a: { apiKey: "1" }, b: { sharedSecret: "2" }, c: { authToken: "3" } };
    expect(jumpcloudSensitivityHits({ document }).map((h) => h.pointer)).toStrictEqual([
      "/a/apiKey",
      "/b/sharedSecret",
      "/c/authToken",
    ]);
  });

  it("keeps posture fields that merely look alarming", () => {
    const document = {
      systems: [{ hasSecureToken: true, passwordExpirationInDays: 90, mfaEnrollment: { totpStatus: "active" } }],
    };
    expect(jumpcloudSensitivityHits({ document })).toStrictEqual([]);
  });

  it("passes what the projection produced, which is the layering working as designed", () => {
    const raw = { applications: [{ displayName: "Okta", idpPrivateKey: "-----BEGIN PRIVATE KEY-----" }] };
    const projected = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: raw });
    expect(projected.dropped).toStrictEqual([{ pointer: "/applications/0/idpPrivateKey", reason: "secret-material" }]);
    expect(jumpcloudSensitivityHits({ document: projected.value })).toStrictEqual([]);
  });

  it("still catches what the projection could not, which is why the third layer exists", () => {
    const raw = { commands: [{ commandText: "-----BEGIN PRIVATE KEY-----" }] };
    const projected = projectJumpcloudValue({ endpoint: ANY_ENDPOINT, value: raw });
    expect(projected.dropped).toStrictEqual([]);
    expect(jumpcloudSensitivityHits({ document: projected.value }).length).toBe(1);
  });
});

describe("admitJumpcloudGeneration", () => {
  it("hands back the document a writer stores, so the gate sits in the control flow rather than a convention", () => {
    const document = { systems: [{ _id: "65a0", hostname: "host" }] };
    const result = admitJumpcloudGeneration({ document });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toStrictEqual(document);
  });

  it("refuses the WHOLE generation on unanticipated secret material rather than redacting it", () => {
    const result = admitJumpcloudGeneration({
      document: { commands: [{ commandText: "-----BEGIN PRIVATE KEY-----\nMIIE" }] },
    });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result)).toStrictEqual([
      "refusing the whole generation: value matches PEM private key block at /commands/0/commandText",
    ]);
  });

  it("reports every reason at once, because a publisher fixing one at a time learns nothing", () => {
    const result = admitJumpcloudGeneration({
      document: { a: { apiKey: "k" }, b: "-----BEGIN OPENSSH PRIVATE KEY-----" },
    });
    expect(unwrapErr(result).length).toBe(3);
  });

  it("names the document root rather than an empty pointer when the whole value is the problem", () => {
    const result = admitJumpcloudGeneration({ document: "-----BEGIN RSA PRIVATE KEY-----" });
    expect(unwrapErr(result)).toStrictEqual([
      "refusing the whole generation: value matches PEM private key block at the document root",
    ]);
  });

  // The gate's
  // one line is an actual secret, and a public key is not one. Every private-key spelling a PEM or OpenSSH
  // encoder writes still refuses; the three public block types a JumpCloud MDM read returns are admitted.
  it.each([
    ["RSA", "-----BEGIN RSA PRIVATE KEY-----\nMIIE"],
    ["EC", "-----BEGIN EC PRIVATE KEY-----\nMHcC"],
    ["OPENSSH", "-----BEGIN OPENSSH PRIVATE KEY-----\nb3Bl"],
    ["PKCS8", "-----BEGIN PRIVATE KEY-----\nMIIE"],
    ["ENCRYPTED", "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIF"],
  ])("still refuses a %s private key block, which is an actual secret", (_label, block) => {
    const result = admitJumpcloudGeneration({ document: { applemdms: [{ certificate: block }] } });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result).join(" ")).toContain("value matches PEM private key block at /applemdms/0/certificate");
  });

  it.each([
    ["CERTIFICATE REQUEST", "-----BEGIN CERTIFICATE REQUEST-----\nMIIC"],
    ["PUBLIC KEY", "-----BEGIN PUBLIC KEY-----\nMFkw"],
    ["CERTIFICATE", "-----BEGIN CERTIFICATE-----\nMIIF"],
  ])("admits a %s block, which carries no private key", (_label, block) => {
    const document = { applemdms: [{ certificate: block }] };
    expect(unwrap(admitJumpcloudGeneration({ document }))).toStrictEqual(document);
  });

  it("never carries the offending value into the refusal", () => {
    const result = admitJumpcloudGeneration({ document: { notes: "-----BEGIN PRIVATE KEY-----\nSECRETBYTES" } });
    expect(unwrapErr(result).join(" ").includes("SECRETBYTES")).toBe(false);
  });

  it("refuses material carried in a property NAME, which a value-only scan admits", () => {
    const result = admitJumpcloudGeneration({ document: { "-----BEGIN PRIVATE KEY-----": "metadata" } });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result)).toStrictEqual([
      "refusing the whole generation: property NAME matches PEM private key block at /-----BEGIN PRIVATE KEY-----",
    ]);
  });

  it("refuses a key-carried token nested inside an array of records", () => {
    const result = admitJumpcloudGeneration({
      document: { rows: [{ ok: 1 }, { AKIAZZZZZZZZZZZZZZZZ: "who" }] },
    });
    expect(unwrapErr(result)).toStrictEqual([
      "refusing the whole generation: property NAME matches AWS access key id at /rows/1/AKIAZZZZZZZZZZZZZZZZ",
    ]);
  });

  it("catches a JumpCloud API key wrapped in underscores, which a word-boundary pattern lets through", () => {
    const result = admitJumpcloudGeneration({
      document: { notes: "prefix_0123456789abcdef0123456789abcdef01234567_suffix" },
    });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result)).toStrictEqual([
      "refusing the whole generation: value matches JumpCloud API key at /notes",
    ]);
  });

  it("catches an AWS access key id wrapped the same way", () => {
    const result = admitJumpcloudGeneration({ document: { notes: "x_AKIAZZZZZZZZZZZZZZZZ_y" } });
    expect(unwrapErr(result)).toStrictEqual([
      "refusing the whole generation: value matches AWS access key id at /notes",
    ]);
  });

  it("does not call a sha256 digest a credential, because the atlas stores many and none of them is one", () => {
    const digest = "22bd7ed90a3e2165ecb9043fb28f17a58e3c9fe0f419f93c57cb235ff2803678";
    expect(admitJumpcloudGeneration({ document: { sha256: digest } }).isOk()).toBe(true);
  });

  it("catches a JSON Web Token wrapped in underscores, the same evasion as the two above", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1g";
    const result = admitJumpcloudGeneration({ document: { notes: `prefix_${jwt}_suffix` } });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result)).toStrictEqual(["refusing the whole generation: value matches JSON Web Token at /notes"]);
  });

  it("judges what would be WRITTEN, so a toJSON that produces a secret is refused", () => {
    const document = {
      toJSON: () => ({ notes: "-----BEGIN PRIVATE KEY-----" }),
    };
    const result = admitJumpcloudGeneration({ document });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result)).toStrictEqual([
      "refusing the whole generation: value matches PEM private key block at /notes",
    ]);
  });

  it("hands back the serialised value, so a writer cannot serialise something the gate never saw", () => {
    const document = { keep: "yes", toJSON: () => ({ keep: "no" }) };
    expect(unwrap(admitJumpcloudGeneration({ document }))).toStrictEqual({ keep: "no" });
  });

  it("refuses a document that cannot be serialised at all, rather than admitting one nothing can describe", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const result = admitJumpcloudGeneration({ document: cyclic });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result)[0]).toContain("it cannot be serialised");
  });

  it("catches a temporary AWS access key id, not only a long-lived one", () => {
    const result = admitJumpcloudGeneration({ document: { notes: "ASIAZZZZZZZZZZZZZZZZ" } });
    expect(unwrapErr(result)).toStrictEqual([
      "refusing the whole generation: value matches AWS access key id at /notes",
    ]);
  });
});

describe("the certificate-identifier exception", () => {
  // MEASURED: `GET /api/v2/systeminsights/certificates` returns all three of these as forty hex
  // characters, which is exactly the JumpCloud API key shape.
  const thumbprint = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

  it("admits a certificate thumbprint, which would otherwise make System Insights unsyncable", () => {
    expect(jumpcloudSensitivityHits({ document: { sha1: thumbprint } })).toStrictEqual([]);
  });

  it("admits the two key identifiers beside it", () => {
    expect(
      jumpcloudSensitivityHits({ document: { authority_key_id: thumbprint, subject_key_id: thumbprint } }),
    ).toStrictEqual([]);
  });

  it("carries the exception into an array, so the provider's own shape does not decide it", () => {
    expect(jumpcloudSensitivityHits({ document: { sha1: [thumbprint] } })).toStrictEqual([]);
  });

  it("still refuses the same forty hex characters anywhere else", () => {
    const hits = jumpcloudSensitivityHits({ document: { notes: thumbprint } });
    expect(hits.length).toBe(1);
    expect(hits[0]!.finding).toBe("value matches JumpCloud API key");
  });

  it("still refuses a nested field of another name under a certificate field", () => {
    const hits = jumpcloudSensitivityHits({ document: { sha1: { inner: thumbprint } } });
    expect(hits.length).toBe(1);
    expect(hits[0]!.pointer).toBe("/sha1/inner");
  });

  it("narrows ONLY the forty-hex shape — a PEM block at a certificate field still refuses", () => {
    const hits = jumpcloudSensitivityHits({ document: { sha1: "-----BEGIN PRIVATE KEY-----\nAAA" } });
    expect(hits.length).toBe(1);
    expect(hits[0]!.finding).toBe("value matches PEM private key block");
  });

  it("still refuses a certificate field NAME that is itself credential-shaped", () => {
    const hits = jumpcloudSensitivityHits({ document: { [thumbprint]: "harmless" } });
    expect(hits.length).toBe(1);
    expect(hits[0]!.finding).toBe("property NAME matches JumpCloud API key");
  });
});

describe("a filesystem path may carry a build hash", () => {
  const key = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

  it("admits a path containing forty hex characters, measured live on systeminsights/apps", () => {
    const path = `~/Library/Application Support/com.raycast.macos/Updates/1.104.28-${key}/Raycast.app`;
    expect(jumpcloudSensitivityHits({ document: { path } })).toStrictEqual([]);
  });

  it("still refuses the same forty hex characters under any other field name", () => {
    expect(jumpcloudSensitivityHits({ document: { notes: key } }).length).toBe(1);
  });

  it("still refuses a PEM block under `path`, because only the hex shape is narrowed", () => {
    const hits = jumpcloudSensitivityHits({ document: { path: "-----BEGIN PRIVATE KEY-----\nAAA" } });
    expect(hits.length).toBe(1);
    expect(hits[0]!.finding).toBe("value matches PEM private key block");
  });

  it("still refuses an AWS key id under `path`, because a service's `path` is a COMMAND LINE", () => {
    // `GET /api/v2/systeminsights/services` returns each service's launch command line, which can carry
    // credential material such as `--env AWS_ACCESS_KEY_ID=<key>`. Exempting this shape here would publish it.
    const path = "C:\\svc-wrapper.exe run --name acme-worker --env AWS_ACCESS_KEY_ID=AKIAZZZZZZZZZZZZZZZZ -- app.exe";
    const hits = jumpcloudSensitivityHits({ document: { path } });
    expect(hits.length).toBe(1);
    expect(hits[0]!.finding).toBe("value matches AWS access key id");
  });
});

describe("an app bundle's own version fields carry a build hash", () => {
  // `GET /api/v2/systeminsights/apps` returns `bundle_version`
  // as bare lowercase hex at lengths 7 through 17 as well as 40 — a `git describe`, not a credential.
  // Reproduce over a walk's resume journal with the command in `shapeExemptions.ts`.
  const commit = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

  it("admits a forty-hex bundle_version, which would otherwise refuse every generation", () => {
    expect(jumpcloudSensitivityHits({ document: { bundle_version: commit } })).toStrictEqual([]);
  });

  it("admits a forty-hex run inside info_string, where the same build hash reappears", () => {
    const info = `Widget 4.2.1, build ${commit}, Copyright 2026`;
    expect(jumpcloudSensitivityHits({ document: { info_string: info } })).toStrictEqual([]);
  });

  it("narrows ONLY the forty-hex shape — an AWS key id under bundle_version still refuses", () => {
    const hits = jumpcloudSensitivityHits({ document: { bundle_version: "AKIAZZZZZZZZZZZZZZZZ" } });
    expect(hits.length).toBe(1);
    expect(hits[0]!.finding).toBe("value matches AWS access key id");
  });

  it("still refuses the same forty hex characters under any other field name", () => {
    expect(jumpcloudSensitivityHits({ document: { bundleVersion: commit } }).length).toBe(1);
  });
});

describe("a device-management policy value is deliberately NOT exempt", () => {
  // A policy value can legitimately BE a credential, so nothing here can tell a benign one from a real
  // one. The exemption table names no `value` field, and this test is what stops one being added quietly.
  const commit = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

  it("refuses a credential-shaped managed-policy value", () => {
    const hits = jumpcloudSensitivityHits({ document: { name: "SomePolicy", value: commit } });
    expect(hits.length).toBe(1);
    expect(hits[0]!.pointer).toBe("/value");
  });

  it("refuses an AWS-shaped policy value too", () => {
    const hits = jumpcloudSensitivityHits({ document: { value: "ASIAZZZZZZZZZZZZZZZZ" } });
    expect(hits.length).toBe(1);
    expect(hits[0]!.finding).toBe("value matches AWS access key id");
  });
});

describe("a credential this process itself holds", () => {
  const key = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

  it("refuses the held key at a field the shape table forgives", () => {
    const hits = jumpcloudSensitivityHits({ document: { sha1: key }, knownSecrets: [key] });
    expect(hits.length).toBe(1);
    expect(hits[0]!.finding).toBe("value matches a credential this process itself holds");
  });

  it("refuses it inside a longer value, so an exempt path cannot smuggle it", () => {
    const hits = jumpcloudSensitivityHits({ document: { path: `/tmp/${key}/x` }, knownSecrets: [key] });
    expect(hits.length).toBe(1);
    expect(hits[0]!.pointer).toBe("/path");
  });

  it("refuses it at a property NAME as well as a value", () => {
    const hits = jumpcloudSensitivityHits({ document: { [key]: "harmless" }, knownSecrets: [key] });
    expect(hits.map((hit) => hit.finding)).toStrictEqual([
      "property NAME matches JumpCloud API key",
      "property NAME matches a credential this process itself holds",
    ]);
  });

  it("ignores an empty needle, which would otherwise match every string in the document", () => {
    expect(jumpcloudSensitivityHits({ document: { note: "ok" }, knownSecrets: [""] })).toStrictEqual([]);
  });

  it("admits a document that does not carry the held key", () => {
    const result = admitJumpcloudGeneration({ document: { note: "ok" }, knownSecrets: ["zz-not-here"] });
    expect(result.isOk()).toBe(true);
  });

  it("refuses the whole generation when it does, naming the position", () => {
    const result = admitJumpcloudGeneration({ document: { deep: { note: key } }, knownSecrets: [key] });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result)).toStrictEqual([
      "refusing the whole generation: value matches JumpCloud API key at /deep/note",
      "refusing the whole generation: value matches a credential this process itself holds at /deep/note",
    ]);
  });
});

describe("the written round trip, taken in pieces", () => {
  it("agrees with a whole-document round trip on an ordinary document", () => {
    const document = { a: [1, "two", { b: null }], c: { d: true } };

    const round = writtenValue({ value: document });

    expect(round.isOk()).toBe(true);
    expect(unwrap(round).written).toEqual(JSON.parse(JSON.stringify(document)));
  });

  it("drops a property that serialises to nothing, exactly as JSON.stringify does", () => {
    const round = writtenValue({ value: { keep: 1, gone: undefined, alsoGone: () => 1 } });

    expect(unwrap(round).written).toEqual({ keep: 1 });
  });

  it("writes null for an array element that serialises to nothing, not a hole", () => {
    const round = writtenValue({ value: [1, undefined, 3] });

    expect(unwrap(round).written).toEqual([1, null, 3]);
  });

  it("honours a toJSON, so the gate judges what a writer would actually write", () => {
    const round = writtenValue({ value: { at: new Date("2026-09-07T00:00:00.000Z") } });

    expect(unwrap(round).written).toEqual({ at: "2026-09-07T00:00:00.000Z" });
  });

  it("reports a value that is omitted entirely rather than calling it written", () => {
    expect(unwrap(writtenValue({ value: undefined })).omitted).toBe(true);
  });

  it("refuses a subtree that cannot be serialised for a reason other than size", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    const round = writtenValue({ value: { held: circular } });

    expect(round.isErr()).toBe(true);
    expect(unwrapErr(round)[0]).toContain("circular");
  });

  it("descends past the SIZE failure and rebuilds the same document its children describe", () => {
    // The real failure made deterministic, without minting 512 MiB. A NON-ENUMERABLE `toJSON` throwing the
    // exact RangeError V8 throws means the whole-document stringify fails while the children are ordinary,
    // so this walks the descent path end to end and the result must equal what a whole round trip gives.
    const document: Record<string, unknown> = { count: 3, entities: [{ id: "a" }, { id: "b" }], nested: { on: true } };
    Object.defineProperty(document, "toJSON", {
      enumerable: false,
      value: () => {
        throw new RangeError("Invalid string length");
      },
    });

    const round = writtenValue({ value: document });

    expect(round.isOk()).toBe(true);
    expect(unwrap(round).written).toEqual({
      count: 3,
      entities: [{ id: "a" }, { id: "b" }],
      nested: { on: true },
    });
  });

  it("refuses a BigInt rather than descending, because size is not why it cannot be written", () => {
    expect(unwrapErr(writtenValue({ value: { held: 1n } }))).toEqual(["Do not know how to serialize a BigInt"]);
  });
});
