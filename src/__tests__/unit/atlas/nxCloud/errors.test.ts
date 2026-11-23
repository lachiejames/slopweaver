import { describe, expect, it } from "vitest";

import { NxCloudAtlasErrors } from "../../../../atlas/nxCloud/errors.js";

describe("NxCloudAtlasErrors.callFailed", () => {
  it("reports a call that never got a status as not completed", () => {
    const error = NxCloudAtlasErrors.callFailed({ call: "workspaces", statusCode: null, detail: "socket hang up" });
    expect(error).toEqual({
      call: "workspaces",
      code: "CALL_FAILED",
      message: "the workspaces call did not complete: socket hang up",
      statusCode: null,
    });
  });

  it("reports a call that answered with a status and carries it", () => {
    const error = NxCloudAtlasErrors.callFailed({
      call: "workspaces",
      statusCode: 503,
      detail: "upstream unavailable",
    });
    expect(error).toEqual({
      call: "workspaces",
      code: "CALL_FAILED",
      message: "the workspaces call answered HTTP 503: upstream unavailable",
      statusCode: 503,
    });
  });

  it("treats a status of zero as a status rather than as absent", () => {
    const error = NxCloudAtlasErrors.callFailed({ call: "runs", statusCode: 0, detail: "" });
    expect(error).toEqual({
      call: "runs",
      code: "CALL_FAILED",
      message: "the runs call answered HTTP 0: ",
      statusCode: 0,
    });
  });
});

describe("NxCloudAtlasErrors.payloadUnreadable", () => {
  it("names the call and the detail", () => {
    const error = NxCloudAtlasErrors.payloadUnreadable({ call: "runs", detail: "missing field `items`" });
    expect(error).toEqual({
      call: "runs",
      code: "PAYLOAD_UNREADABLE",
      message: "the runs response could not be read as this build expects — missing field `items`",
    });
  });

  it("keeps an empty detail verbatim", () => {
    const error = NxCloudAtlasErrors.payloadUnreadable({ call: "runs", detail: "" });
    expect(error).toEqual({
      call: "runs",
      code: "PAYLOAD_UNREADABLE",
      message: "the runs response could not be read as this build expects — ",
    });
  });
});

describe("NxCloudAtlasErrors.sessionAbsent", () => {
  it("carries the detail and tells the owner where to sign in", () => {
    const error = NxCloudAtlasErrors.sessionAbsent({ detail: "keyring refused the read" });
    expect(error).toEqual({
      code: "SESSION_ABSENT",
      detail: "keyring refused the read",
      message:
        "your Chrome profile holds no Nx Cloud session, so nothing here can read the platform: keyring refused the read. Sign in at cloud.nx.app in the profile `slopweaver browser profile` reports",
    });
  });

  it("keeps an empty detail verbatim", () => {
    const error = NxCloudAtlasErrors.sessionAbsent({ detail: "" });
    expect(error).toEqual({
      code: "SESSION_ABSENT",
      detail: "",
      message:
        "your Chrome profile holds no Nx Cloud session, so nothing here can read the platform: . Sign in at cloud.nx.app in the profile `slopweaver browser profile` reports",
    });
  });
});
