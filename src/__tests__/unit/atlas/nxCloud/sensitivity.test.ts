import { describe, expect, it } from "vitest";

import { admitNxCloudDocument, keyParts, scanNxCloudSensitivity } from "../../../../atlas/nxCloud/sensitivity.js";
import { unwrapErr } from "../../../../lib/result.js";

/** A document in the shape this atlas actually writes, carrying nothing it must not. */
const CLEAN_DOCUMENT = {
  entities: [
    {
      channels: {
        browser: null,
        "web-data": { detail: { name: "example-monorepo", patAccessLevel: "READ_ONLY" }, state: "observed" },
      },
      id: "013d86bcf427500b2d7db3c7b8310fd9",
      kind: "workspace",
      providerId: "0000000000000000000000b2",
    },
  ],
  kind: "workspace",
  platform: "nx-cloud",
};

describe("keyParts", () => {
  it("splits camelCase", () => {
    expect(keyParts({ key: "accessToken" })).toEqual(["access", "token"]);
  });

  it("splits snake_case", () => {
    expect(keyParts({ key: "access_token" })).toEqual(["access", "token"]);
  });

  it("lowercases every part, so one rule covers every spelling", () => {
    expect(keyParts({ key: "ACCESS-TOKEN" })).toEqual(["access", "token"]);
  });
});

describe("scanNxCloudSensitivity", () => {
  it("finds nothing in a document this atlas would really write", () => {
    expect(scanNxCloudSensitivity({ denylist: [], document: CLEAN_DOCUMENT })).toEqual([]);
  });

  it("refuses a credential key the client's own payload carries", () => {
    const leaked = { entities: [{ detail: { ENV: { rollbar: { accessToken: "abc" } } } }] };
    const findings = scanNxCloudSensitivity({ denylist: [], document: leaked });
    expect(findings.map((finding) => finding.label)).toContain("forbidden-key");
  });

  it("names the path to the offending key rather than printing its value", () => {
    const leaked = { entities: [{ detail: { apiKey: "phc_secret" } }] };
    const finding = scanNxCloudSensitivity({ denylist: [], document: leaked }).find(
      (candidate) => candidate.label === "forbidden-key",
    )!;
    expect(finding.path).toBe("entities.0.detail.apiKey");
  });

  it("never carries the offending value into the finding itself", () => {
    const leaked = { entities: [{ detail: { apiKey: "phc_secretvalue0000000000" } }] };
    const findings = scanNxCloudSensitivity({ denylist: [], document: leaked });
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(JSON.stringify(leaked)).toContain("phc_secretvalue0000000000");
    expect(JSON.stringify(findings)).not.toContain("phc_secretvalue0000000000");
  });

  it("refuses a PostHog key that reached the document under an innocent key name", () => {
    const leaked = { entities: [{ detail: { note: "phc_FIXTURE0posthog0key0000000000" } }] };
    const findings = scanNxCloudSensitivity({ denylist: [], document: leaked });
    expect(findings.map((finding) => finding.label)).toContain("posthog-key");
  });

  it("refuses the session cookie itself, whatever route it took to get there", () => {
    const leaked = { entities: [{ detail: { note: "cookie: _nxCloudSession=abc" } }] };
    const findings = scanNxCloudSensitivity({ denylist: [], document: leaked });
    expect(findings.map((finding) => finding.label)).toContain("nx-cloud-session-cookie");
  });

  it("REPORTS a private denylist word rather than refusing, because the organisation is the subject", () => {
    const findings = scanNxCloudSensitivity({ denylist: ["example-monorepo"], document: CLEAN_DOCUMENT });
    expect(findings.map((finding) => finding.disposition)).toEqual(["report"]);
  });

  it("does not refuse over an artifact digest, which is 64 hex characters by design", () => {
    const withArtifact = {
      entities: [{ artifacts: [{ sha256: "a".repeat(64) }] }],
    };
    expect(scanNxCloudSensitivity({ denylist: [], document: withArtifact })).toEqual([]);
  });
});

describe("admitNxCloudDocument", () => {
  it("admits a clean document", () => {
    expect(admitNxCloudDocument({ denylist: [], document: CLEAN_DOCUMENT, label: "workspace file" }).isOk()).toBe(true);
  });

  it("refuses a document carrying a credential key, naming what is being written", () => {
    const refused = admitNxCloudDocument({
      denylist: [],
      document: { detail: { clientSecret: "x" } },
      label: "workspace file",
    });
    expect(unwrapErr(refused)).toEqual([
      "refusing to write workspace file: the sensitivity gate found 1 thing(s) that must never reach this atlas",
      "  detail.clientSecret: the key `clientSecret` names a credential or a personal identifier this atlas " +
        "never holds [witness 9a5f75fe98e5]",
      "nothing was written — the value itself is deliberately not printed above",
    ]);
  });

  it("says nothing was written, so a caller knows the store is untouched", () => {
    const refused = admitNxCloudDocument({ denylist: [], document: { detail: { token: "x" } }, label: "f" });
    expect(refused._unsafeUnwrapErr().at(-1)).toContain("nothing was written");
  });

  it("admits a document whose only finding is a denylist hit, and hands the finding back", () => {
    const admitted = admitNxCloudDocument({
      denylist: ["example-monorepo"],
      document: CLEAN_DOCUMENT,
      label: "workspace file",
    });
    expect(admitted._unsafeUnwrap().length).toBe(1);
  });
});
