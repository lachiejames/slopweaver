import { describe, expect, it } from "vitest";

import { admitDatadogGeneration, datadogSensitivityHits } from "../../../../atlas/datadog/sensitivity.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const NO_SECRETS: readonly string[] = [];

describe("datadogSensitivityHits", () => {
  it("finds a denied field name under the kind that makes it secret", () => {
    const hits = datadogSensitivityHits({
      document: { data: { attributes: { key: "value" } } },
      kind: "api_keys",
      knownSecrets: NO_SECRETS,
    });

    expect(hits.length).toBe(1);
    expect(hits[0]?.pointer).toBe("/data/attributes/key");
  });

  // The gate has to be kind-scoped for the same reason the projection is: a flat name check would refuse
  // every generation this atlas can publish, because `key` is a case identifier on forty-three models.
  it("does not fire on the same field name under a kind where it is an ordinary identifier", () => {
    const hits = datadogSensitivityHits({
      document: { data: { attributes: { key: "CASE-14" } } },
      kind: "cases",
      knownSecrets: NO_SECRETS,
    });

    expect(hits).toStrictEqual([]);
  });

  it("recognises a PEM private key wherever it appears, whatever the field is called", () => {
    const hits = datadogSensitivityHits({
      document: { notes: "-----BEGIN RSA PRIVATE KEY-----\nabc" },
      kind: "monitor",
      knownSecrets: NO_SECRETS,
    });

    expect(hits[0]?.finding).toBe("value matches PEM private key block");
  });

  it("recognises a JWT past a leading underscore, which a word boundary would have walked over", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1";
    const hits = datadogSensitivityHits({
      document: { message: `prefix_${token}_suffix` },
      kind: "monitor",
      knownSecrets: NO_SECRETS,
    });

    expect(hits[0]?.finding).toBe("value matches JSON Web Token");
  });

  // A git commit SHA is 40 lowercase hex and this atlas stores them on CI, DORA and static-analysis
  // records; an md5 digest is 32. A hex rule copied from the sibling atlas would refuse most real
  // generations, so its ABSENCE is deliberate and this test is what pins it.
  it("does NOT fire on a bare hex run, because Datadog legitimately stores commit SHAs and digests", () => {
    const hits = datadogSensitivityHits({
      document: { md5: "d41d8cd98f00b204e9800998ecf8427e", sha: "da39a3ee5e6b4b0d3255bfef95601890afd80709" },
      kind: "ci",
      knownSecrets: NO_SECRETS,
    });

    expect(hits).toStrictEqual([]);
  });

  // What replaces the hex rule: zero false positives on the one secret whose escape would matter most.
  it("refuses a credential this process itself holds, matched verbatim", () => {
    const hits = datadogSensitivityHits({
      document: { note: "the key is d41d8cd98f00b204e9800998ecf8427e" },
      kind: "ci",
      knownSecrets: ["d41d8cd98f00b204e9800998ecf8427e"],
    });

    expect(hits[0]?.finding).toBe("value matches a credential this process itself holds");
  });

  // A JSON object's KEY is written to disk exactly as a value is, so a value-only scan admits material
  // carried in the key and nothing in the value.
  it("scans object KEYS as well as values", () => {
    const hits = datadogSensitivityHits({
      document: { "-----BEGIN OPENSSH PRIVATE KEY-----": "metadata" },
      kind: "monitor",
      knownSecrets: NO_SECRETS,
    });

    expect(hits[0]?.finding).toBe("property NAME matches PEM private key block");
  });

  it("recognises a Datadog RUM client token by its prefix", () => {
    const hits = datadogSensitivityHits({
      document: { t: "pubd41d8cd98f00b204e9800998ecf8427e" },
      kind: "rum",
      knownSecrets: NO_SECRETS,
    });

    expect(hits[0]?.finding).toBe("value matches Datadog RUM client token");
  });

  it("sorts findings by pointer so a refusal reads in document order", () => {
    const hits = datadogSensitivityHits({
      document: { z: { password: "a" }, a: { clientSecret: "b" } },
      kind: "integrations",
      knownSecrets: NO_SECRETS,
    });

    expect(hits.map((hit) => hit.pointer)).toStrictEqual(["/a/clientSecret", "/z/password"]);
  });
});

describe("admitDatadogGeneration", () => {
  it("hands back the document it judged when nothing was found", () => {
    const admitted = admitDatadogGeneration({
      document: { entities: [{ id: "m-1" }] },
      kind: "monitor",
      knownSecrets: NO_SECRETS,
    });

    expect(admitted.isOk()).toBe(true);
    expect(unwrap(admitted)).toStrictEqual({ entities: [{ id: "m-1" }] });
  });

  // Before the kind was narrowed, a misspelled kind matched no scoped field row, so an api_keys document's
  // `key` — the API key itself — was ADMITTED. An unknown kind now refuses the whole generation instead.
  it("refuses a generation under a kind the field table was never reviewed against, instead of admitting it", () => {
    const document = { data: { attributes: { key: "a-live-api-key" } } };
    expect(admitDatadogGeneration({ document, kind: "api_keys", knownSecrets: NO_SECRETS }).isErr()).toBe(true);

    const admitted = admitDatadogGeneration({ document, kind: "api_keyz", knownSecrets: NO_SECRETS });

    expect(unwrapErr(admitted)).toStrictEqual([
      'refusing the whole api_keyz generation: kind "api_keyz" is not one this atlas publishes, so no field rule can say which of its fields are credential material at the document root',
    ]);
  });

  it("refuses an unknown kind even for a document carrying nothing secret-shaped", () => {
    const hits = datadogSensitivityHits({ document: { id: "m-1" }, kind: "monitors", knownSecrets: NO_SECRETS });

    expect(hits).toStrictEqual([
      {
        finding:
          'kind "monitors" is not one this atlas publishes, so no field rule can say which of its fields are credential material',
        pointer: "",
      },
    ]);
  });

  it("writes a root undefined as JSON null, the way the serialiser writes one inside an array", () => {
    const admitted = admitDatadogGeneration({ document: undefined, kind: "monitor", knownSecrets: NO_SECRETS });

    expect(admitted.isOk()).toBe(true);
    expect(unwrap(admitted)).toBe(null);
  });

  // Redaction leaves a generation that is MOSTLY clean and therefore looks publishable, and it silently
  // teaches a reader that the boundary held when it has just been breached.
  it("refuses the WHOLE generation rather than redacting the offending position", () => {
    const admitted = admitDatadogGeneration({
      document: { entities: [{ clientSecret: "x" }, { id: "ok" }] },
      kind: "integrations",
      knownSecrets: NO_SECRETS,
    });

    expect(admitted.isErr()).toBe(true);
    expect(unwrapErr(admitted)[0]).toContain("refusing the whole integrations generation");
  });

  it("names every reason at once, because the multiplicity is what a reader needs", () => {
    const admitted = admitDatadogGeneration({
      document: { a: { clientSecret: "x" }, b: { password: "y" } },
      kind: "integrations",
      knownSecrets: NO_SECRETS,
    });

    expect(unwrapErr(admitted).length).toBe(2);
  });

  // The scan walks a value; a writer serialises one. A gate that inspects one and admits the other has
  // checked nothing.
  it("judges the BYTES, so a toJSON cannot smuggle a field past the scan", () => {
    const admitted = admitDatadogGeneration({
      document: { toJSON: () => ({ clientSecret: "smuggled" }) },
      kind: "integrations",
      knownSecrets: NO_SECRETS,
    });

    expect(unwrapErr(admitted)).toEqual([
      'refusing the whole integrations generation: field "clientSecret" is secret material in kind ' +
        '"integrations" and must never be stored at /clientSecret',
    ]);
  });

  it("refuses a document that cannot be serialised at all, since nothing can say what would be written", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const admitted = admitDatadogGeneration({ document: cyclic, kind: "monitor", knownSecrets: NO_SECRETS });

    expect(unwrapErr(admitted)[0]).toContain("it cannot be serialised");
  });

  it("names the document root when the offending position is the whole document", () => {
    const admitted = admitDatadogGeneration({
      document: "-----BEGIN PRIVATE KEY-----",
      kind: "monitor",
      knownSecrets: NO_SECRETS,
    });

    expect(unwrapErr(admitted)[0]).toContain("at the document root");
  });
});
