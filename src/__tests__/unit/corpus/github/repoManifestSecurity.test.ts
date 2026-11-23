/**
 * The settings apply's two security settings, through a real Octokit over a recording fake transport: a status
 * GitHub omitted is refused by name rather than read as off; a write sends GitHub's own status words once; and
 * private vulnerability reporting is switched by its own endpoint for each direction.
 */
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";

import {
  getPrivateVulnerabilityReportingVia,
  getSecretScanningVia,
  setPrivateVulnerabilityReportingVia,
  setSecretScanningVia,
} from "../../../../corpus/github/repoManifestSecurity.js";
import type { WriteCtx } from "../../../../corpus/github/writeCtx.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  always,
  type FakeAnswer,
  recordingFetch,
  recordingScopeId,
  type SentRequest,
} from "../../../githubRecordingCtx.js";

const INPUT = { owner: "acme", repo: "widget" };

/** A write context over a real Octokit, built in this test file, whose fake transport records every request. */
function recordingCtx(fake: { sent: SentRequest[]; respond: (request: SentRequest) => FakeAnswer }): WriteCtx {
  return {
    client: new Octokit({ auth: "test-token", request: { fetch: recordingFetch(fake) } }),
    scopeId: recordingScopeId(),
  };
}
const REPO_URL = "https://api.github.com/repos/acme/widget";

describe("getSecretScanningVia", () => {
  it("reads both switches from the repository's security block", async () => {
    const ctx = recordingCtx({
      respond: always({
        data: {
          security_and_analysis: {
            secret_scanning: { status: "enabled" },
            secret_scanning_push_protection: { status: "disabled" },
          },
        },
        status: 200,
      }),
      sent: [],
    });

    expect(unwrap(await getSecretScanningVia({ ctx, input: INPUT }))).toStrictEqual({
      pushProtection: false,
      secretScanning: true,
    });
  });

  it("refuses a read with no push protection status rather than reading it as off", async () => {
    const ctx = recordingCtx({
      respond: always({ data: { security_and_analysis: { secret_scanning: { status: "enabled" } } }, status: 200 }),
      sent: [],
    });

    expect(unwrapErr(await getSecretScanningVia({ ctx, input: INPUT })).message).toContain(
      "GitHub's repository read gave no secret_scanning_push_protection status, so it is unknown",
    );
  });

  it("refuses a read with no security block at all", async () => {
    const ctx = recordingCtx({ respond: always({ data: { security_and_analysis: null }, status: 200 }), sent: [] });

    expect(unwrapErr(await getSecretScanningVia({ ctx, input: INPUT })).message).toContain(
      "gave no secret_scanning_push_protection status",
    );
  });
});

describe("setSecretScanningVia", () => {
  it("sends both switches in GitHub's status words, once", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: {}, status: 200 }), sent });

    unwrap(
      await setSecretScanningVia({
        ctx,
        input: { ...INPUT, settings: { pushProtection: true, secretScanning: false } },
      }),
    );

    expect(sent).toStrictEqual([
      {
        body: {
          security_and_analysis: {
            secret_scanning: { status: "disabled" },
            secret_scanning_push_protection: { status: "enabled" },
          },
        },
        method: "PATCH",
        url: REPO_URL,
      },
    ]);
  });
});

describe("getPrivateVulnerabilityReportingVia", () => {
  it("reads the state GitHub reports", async () => {
    const ctx = recordingCtx({ respond: always({ data: { enabled: true }, status: 200 }), sent: [] });

    expect(unwrap(await getPrivateVulnerabilityReportingVia({ ctx, input: INPUT }))).toBe(true);
  });

  it("refuses a read with no state rather than reading it as off", async () => {
    const ctx = recordingCtx({ respond: always({ data: {}, status: 200 }), sent: [] });

    expect(unwrapErr(await getPrivateVulnerabilityReportingVia({ ctx, input: INPUT })).message).toContain(
      "GitHub's private vulnerability reporting read gave no state, so it is unknown",
    );
  });
});

describe("setPrivateVulnerabilityReportingVia", () => {
  it("turns it on with one PUT", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: null, status: 204 }), sent });

    unwrap(await setPrivateVulnerabilityReportingVia({ ctx, input: { ...INPUT, enabled: true } }));

    expect(sent.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `PUT ${REPO_URL}/private-vulnerability-reporting`,
    ]);
  });

  it("turns it off with one DELETE", async () => {
    const sent: SentRequest[] = [];
    const ctx = recordingCtx({ respond: always({ data: null, status: 204 }), sent });

    unwrap(await setPrivateVulnerabilityReportingVia({ ctx, input: { ...INPUT, enabled: false } }));

    expect(sent.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `DELETE ${REPO_URL}/private-vulnerability-reporting`,
    ]);
  });

  it("names the direction it was sending in the failure", async () => {
    const ctx = recordingCtx({ respond: always({ data: { message: "Forbidden" }, status: 403 }), sent: [] });

    const error = unwrapErr(await setPrivateVulnerabilityReportingVia({ ctx, input: { ...INPUT, enabled: false } }));

    expect(error.operation).toBe("github.repos.disablePrivateVulnerabilityReporting");
  });
});
