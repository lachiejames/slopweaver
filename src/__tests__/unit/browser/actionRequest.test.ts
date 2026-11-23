import { describe, expect, it } from "vitest";

import { BROWSER_ACTION_KINDS, type BrowserActionKind } from "../../../browser/action.js";
import { BrowserActionErrors } from "../../../browser/actionErrors.js";
import { actionNeedsObservation, type BrowserActionRequest, clientArgsFor } from "../../../browser/actionRequest.js";
import { err, ok, unwrapErr } from "../../../lib/result.js";

/** A complete request for `kind`; each test names the target and value it is about. */
function request({
  kind,
  target,
  value,
}: {
  kind: BrowserActionKind;
  target: string | undefined;
  value: string | undefined;
}): BrowserActionRequest {
  return {
    aimMark: "highlight",
    aimShotStem: "/s/aim",
    downloadDir: undefined,
    downloadOut: undefined,
    expectFocus: undefined,
    expectName: undefined,
    fullPage: false,
    kind,
    observation: undefined,
    screenshotPath: "/s/after.png",
    target,
    value,
  };
}

describe("clientArgsFor", () => {
  it("keeps a fill's text as one argv value after the target", () => {
    expect(clientArgsFor({ request: request({ kind: "fill", target: "e3", value: "hello world; rm -rf" }) })).toEqual(
      ok(["fill", "e3", "hello world; rm -rf"]),
    );
  });

  it("answers the upload sentinel with the target and the file", () => {
    expect(clientArgsFor({ request: request({ kind: "upload", target: "e4", value: "/s/report.pdf" }) })).toEqual(
      ok(["__upload__", "e4", "/s/report.pdf"]),
    );
  });

  it("dispatches a click with a target and refuses one without, as REQUEST_INCOMPLETE with its exact message", () => {
    const accepted = clientArgsFor({ request: request({ kind: "click", target: "e5", value: undefined }) });
    const refused = clientArgsFor({ request: request({ kind: "click", target: undefined, value: undefined }) });

    expect(accepted).toEqual(ok(["click", "e5"]));
    expect(refused).toEqual(
      err(BrowserActionErrors.requestIncomplete({ kind: "click", missing: "--target <ref|selector>" })),
    );
    const error = unwrapErr(refused);
    expect(error.code).toBe("REQUEST_INCOMPLETE");
    expect(error.message).toBe(
      "`--do click` needs --target <ref|selector>. Nothing was dispatched, so the page is exactly as it was.",
    );
  });

  it("treats an empty-string target the same as an absent one", () => {
    expect(clientArgsFor({ request: request({ kind: "click", target: "", value: undefined }) })).toEqual(
      err(BrowserActionErrors.requestIncomplete({ kind: "click", missing: "--target <ref|selector>" })),
    );
  });

  it("dispatches a navigate with a value and refuses one without, as REQUEST_INCOMPLETE naming --value in its exact message", () => {
    const accepted = clientArgsFor({
      request: request({ kind: "navigate", target: undefined, value: "https://example.invalid/" }),
    });
    const refused = clientArgsFor({ request: request({ kind: "navigate", target: undefined, value: undefined }) });

    expect(accepted).toEqual(ok(["goto", "https://example.invalid/"]));
    const error = unwrapErr(refused);
    expect(error).toEqual(BrowserActionErrors.requestIncomplete({ kind: "navigate", missing: "--value <text>" }));
    expect(error.code).toBe("REQUEST_INCOMPLETE");
    expect(error.message).toBe(
      "`--do navigate` needs --value <text>. Nothing was dispatched, so the page is exactly as it was.",
    );
  });
});

describe("actionNeedsObservation", () => {
  it("is true for the thirteen write-capable kinds and false for the six that navigate or answer a dialog", () => {
    expect(BROWSER_ACTION_KINDS.length).toBeGreaterThan(0);
    const needing = BROWSER_ACTION_KINDS.filter((kind) => actionNeedsObservation({ kind }));
    const notNeeding = BROWSER_ACTION_KINDS.filter((kind) => !actionNeedsObservation({ kind }));

    expect(needing).toEqual([
      "click",
      "double-click",
      "fill",
      "type",
      "select",
      "check",
      "uncheck",
      "hover",
      "press",
      "scroll",
      "drag",
      "upload",
      "download",
    ]);
    expect(notNeeding).toEqual(["navigate", "back", "forward", "reload", "dialog-accept", "dialog-dismiss"]);
  });
});
