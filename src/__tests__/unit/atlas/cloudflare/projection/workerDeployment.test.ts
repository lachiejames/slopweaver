import { describe, expect, it } from "vitest";

import { isCloudflareRawWorkerDeployment } from "../../../../../atlas/cloudflare/projection/workerDeployment.js";

const DEPLOYMENT = {
  annotations: { "workers/message": "ship it", "workers/triggered_by": "upload" },
  author_email: "dev@example.com",
  created_on: "2026-10-01T00:00:00.000Z",
  id: "dep-1",
  source: "wrangler",
  strategy: "percentage",
  versions: [{ percentage: 100, version_id: "ver-1" }],
};

describe("isCloudflareRawWorkerDeployment", () => {
  it("admits a deployment carrying every field the SDK declares", () => {
    expect(isCloudflareRawWorkerDeployment(DEPLOYMENT)).toBe(true);
  });

  it("admits one with no annotations and no author, both optional", () => {
    const { annotations: _annotations, author_email: _author, ...bare } = DEPLOYMENT;
    expect(isCloudflareRawWorkerDeployment(bare)).toBe(true);
  });

  it("refuses a value that is not a record", () => {
    expect(isCloudflareRawWorkerDeployment("dep-1")).toBe(false);
  });

  it("refuses an empty id", () => {
    expect(isCloudflareRawWorkerDeployment({ ...DEPLOYMENT, id: "" })).toBe(false);
  });

  it("refuses a deployment missing a field the SDK requires", () => {
    const { source: _source, ...withoutSource } = DEPLOYMENT;
    expect(isCloudflareRawWorkerDeployment(withoutSource)).toBe(false);
  });

  it("refuses a strategy the SDK has not declared", () => {
    expect(isCloudflareRawWorkerDeployment({ ...DEPLOYMENT, strategy: "gradual" })).toBe(false);
  });

  it("refuses a version entry without a numeric percentage", () => {
    expect(isCloudflareRawWorkerDeployment({ ...DEPLOYMENT, versions: [{ percentage: "100", version_id: "v" }] })).toBe(
      false,
    );
  });

  it("refuses annotations carrying a non-string message", () => {
    expect(isCloudflareRawWorkerDeployment({ ...DEPLOYMENT, annotations: { "workers/message": 1 } })).toBe(false);
  });
});
