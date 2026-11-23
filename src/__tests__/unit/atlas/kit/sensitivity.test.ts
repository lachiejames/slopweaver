/**
 * The kit's pre-write sensitivity gate: forbidden key names and credential-shaped values REFUSE, a leak class
 * the policy expects is REPORTED, and no finding ever carries the value it found.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import {
  type AtlasSensitivityPolicy,
  admitAtlasDocument,
  atlasKeyParts,
  isForbiddenAtlasKey,
  scanAtlasSensitivity,
} from "../../../../atlas/kit/sensitivity.js";

const SECRET = "exk_0123456789abcdefghij";

const POLICY: AtlasSensitivityPolicy = {
  forbiddenKeyParts: new Set(["token", "apikey"]),
  reportedLeakClasses: new Map([["denylist", "a private denylist word appears — recorded, not refused"]]),
  valuePatterns: [{ label: "example-key", re: /\bexk_[a-z0-9]{20}\b/ }],
};

/** The same policy with no leak class expected, so a denylist hit refuses. */
const STRICT: AtlasSensitivityPolicy = { ...POLICY, reportedLeakClasses: new Map() };

describe("atlasKeyParts", () => {
  it("splits camelCase, snake_case and kebab-case into lowercased parts", () => {
    expect(atlasKeyParts({ key: "accessToken" })).toEqual(["access", "token"]);
    expect(atlasKeyParts({ key: "access_token" })).toEqual(["access", "token"]);
    expect(atlasKeyParts({ key: "Access-Token" })).toEqual(["access", "token"]);
  });

  it("drops the empty parts a leading or doubled separator leaves", () => {
    expect(atlasKeyParts({ key: "__private--id" })).toEqual(["private", "id"]);
  });
});

describe("isForbiddenAtlasKey", () => {
  it("forbids a key one of whose parts is a forbidden word", () => {
    expect(isForbiddenAtlasKey({ key: "refresh_token", policy: POLICY })).toBe(true);
  });

  it("forbids a key whose parts JOINED are a forbidden word, though each half is innocent", () => {
    expect(isForbiddenAtlasKey({ key: "apiKey", policy: POLICY })).toBe(true);
  });

  it("allows a key none of whose parts, alone or joined, is forbidden", () => {
    expect(isForbiddenAtlasKey({ key: "displayName", policy: POLICY })).toBe(false);
  });
});

describe("scanAtlasSensitivity", () => {
  it("finds nothing in a clean document", () => {
    expect(
      scanAtlasSensitivity({ denylist: [], document: { entities: [{ name: "workspace" }] }, policy: POLICY }),
    ).toEqual([]);
  });

  it("refuses a forbidden key at its full path through arrays", () => {
    const findings = scanAtlasSensitivity({
      denylist: [],
      document: { items: [{ detail: { apiKey: "x" } }] },
      policy: POLICY,
    });

    expect(findings).toEqual([
      {
        disposition: "refuse",
        label: "forbidden-key",
        path: "items.0.detail.apiKey",
        reason: "the key `apiKey` names a credential or a personal identifier this atlas never holds",
        witness: "61ea4113f56b",
      },
    ]);
  });

  it("refuses a credential-shaped value under an innocent key, without carrying the value", () => {
    const document = { note: `pasted ${SECRET} here` };
    const findings = scanAtlasSensitivity({ denylist: [], document, policy: POLICY });

    expect(findings).toEqual([
      {
        disposition: "refuse",
        label: "example-key",
        path: "<document>",
        reason: "a value matching the example-key shape reached the document",
        witness: "8ffda0725419",
      },
    ]);
    expect(JSON.stringify(document)).toContain(SECRET);
    expect(JSON.stringify(findings)).not.toContain(SECRET);
  });

  it("finds a credential in every document even when the policy's pattern carries the g or y flag", () => {
    const global: AtlasSensitivityPolicy = { ...POLICY, valuePatterns: [{ label: "g", re: /exk_[a-z0-9]{20}/g }] };
    const sticky: AtlasSensitivityPolicy = { ...POLICY, valuePatterns: [{ label: "y", re: /\{\s+"note": "exk_/y }] };
    const document = { note: SECRET };

    const labels = [
      ...scanAtlasSensitivity({ denylist: [], document, policy: global }),
      ...scanAtlasSensitivity({ denylist: [], document, policy: global }),
      ...scanAtlasSensitivity({ denylist: [], document, policy: sticky }),
      ...scanAtlasSensitivity({ denylist: [], document, policy: sticky }),
    ].map((finding) => finding.label);

    expect(labels).toEqual(["g", "g", "y", "y"]);
    expect(global.valuePatterns[0]!.re.lastIndex).toBe(0);
    expect(sticky.valuePatterns[0]!.re.lastIndex).toBe(0);
  });

  it("REPORTS a leak class the policy expects, carrying the policy's own reason", () => {
    const findings = scanAtlasSensitivity({
      denylist: ["examplecorp"],
      document: { org: "examplecorp" },
      policy: POLICY,
    });

    expect(findings.map(({ disposition, label, reason }) => ({ disposition, label, reason }))).toEqual([
      { disposition: "report", label: "denylist", reason: "a private denylist word appears — recorded, not refused" },
    ]);
  });

  it("REFUSES the same leak class when the policy does not expect it", () => {
    const findings = scanAtlasSensitivity({
      denylist: ["examplecorp"],
      document: { org: "examplecorp" },
      policy: STRICT,
    });

    expect(findings.map(({ disposition, label, reason }) => ({ disposition, label, reason }))).toEqual([
      {
        disposition: "refuse",
        label: "denylist",
        reason: "a value matching the denylist leak class reached the document",
      },
    ]);
  });
});

describe("admitAtlasDocument", () => {
  it("admits a document whose only findings are reports, and hands them back", () => {
    const admitted = unwrap(
      admitAtlasDocument({
        denylist: ["examplecorp"],
        document: { org: "examplecorp" },
        label: "org.json",
        policy: POLICY,
      }),
    );

    expect(admitted.map((finding) => finding.disposition)).toEqual(["report"]);
  });

  it("refuses a document carrying a refusal, naming what was being written and never the value", () => {
    const refused = unwrapErr(
      admitAtlasDocument({ denylist: [], document: { detail: { token: "x" } }, label: "org.json", policy: POLICY }),
    );

    expect(refused).toEqual([
      "refusing to write org.json: the sensitivity gate found 1 thing(s) that must never reach this atlas",
      "  detail.token: the key `token` names a credential or a personal identifier this atlas never holds [witness 3c469e9d6c58]",
      "nothing was written — the value itself is deliberately not printed above",
    ]);
  });
});
