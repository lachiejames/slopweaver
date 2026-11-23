/**
 * The Xero atlas's typed failures: each factory's code and exact text, and the lines each one prints.
 *
 * A list-carrying variant must print one line per reason — the CLI iterates what the lines helper returns,
 * and printing the joined `message` there instead would fold the correction onto the refusal's own line.
 */
import { describe, expect, it } from "vitest";

import { XeroAtlasErrors, xeroAtlasErrorLines } from "../../../../atlas/xero/errors.js";

describe("XeroAtlasErrors", () => {
  it("quotes the transport's message when the web client is unreachable", () => {
    const error = XeroAtlasErrors.webClientUnreachable({ detail: "timed out" });
    expect(error.code).toBe("WEB_CLIENT_UNREACHABLE");
    expect(xeroAtlasErrorLines({ error })).toEqual([
      "could not reach the Xero web client to learn its organisation root: timed out",
    ]);
  });

  it("prints the sign-in refusal and its correction as two lines", () => {
    const error = XeroAtlasErrors.signedOut();
    expect(error.code).toBe("SIGNED_OUT");
    expect(xeroAtlasErrorLines({ error })).toEqual([
      "the Xero web client sent this browser to its sign-in origin, so no page could be walked",
      "sign in to Xero in your own Chrome and run the walk again",
    ]);
  });

  it("renders a cause that is not an Error when the package cannot be resolved", () => {
    const error = XeroAtlasErrors.sdkUnresolved({ cause: "boom", packageName: "xero-node" });
    expect(error.code).toBe("SDK_UNRESOLVED");
    expect(xeroAtlasErrorLines({ error })).toEqual([
      "could not resolve xero-node: boom",
      "the API surface is read from the installed client, so this atlas cannot be synced without it — run `yarn install`",
    ]);
  });

  it("names the package when its package.json cannot be read", () => {
    const error = XeroAtlasErrors.packageJsonUnreadable({ cause: new Error("EACCES"), packageName: "xero-node" });
    expect(error.code).toBe("PACKAGE_JSON_UNREADABLE");
    expect(error.message).toBe("could not read xero-node's package.json: EACCES");
  });

  it("names the package when it declares no version", () => {
    const error = XeroAtlasErrors.versionUndeclared({ packageName: "xero-node" });
    expect(error.code).toBe("VERSION_UNDECLARED");
    expect(error.message).toBe(
      "xero-node's package.json declares no version, so a stored generation could not name one",
    );
  });

  it("names the API subpath and prints the layout correction as its own line", () => {
    const error = XeroAtlasErrors.apiClassesUnlisted({
      cause: new Error("ENOENT"),
      packageName: "xero-node",
      subpath: "dist/gen/api",
    });
    expect(error.code).toBe("API_CLASSES_UNLISTED");
    expect(xeroAtlasErrorLines({ error })).toEqual([
      "could not list xero-node's generated API classes at dist/gen/api: ENOENT",
      "the package's layout has moved; this atlas's API surface is read from those files and cannot be inferred",
    ]);
  });

  it("names the one API class file it could not read", () => {
    const error = XeroAtlasErrors.apiClassUnreadable({
      cause: new Error("EISDIR"),
      file: "AccountingApi.js",
      packageName: "xero-node",
    });
    expect(error.code).toBe("API_CLASS_UNREADABLE");
    expect(xeroAtlasErrorLines({ error })).toEqual(["could not read xero-node's AccountingApi.js: EISDIR"]);
  });

  it("names the model subpath and prints the response-field consequence as its own line", () => {
    const error = XeroAtlasErrors.modelsUnlisted({
      cause: new Error("ENOENT"),
      packageName: "xero-node",
      subpath: "dist/gen/model",
    });
    expect(error.code).toBe("MODELS_UNLISTED");
    expect(xeroAtlasErrorLines({ error })).toEqual([
      "could not list xero-node's generated models at dist/gen/model: ENOENT",
      "the response-field half of this atlas's API surface is read from those files and cannot be inferred",
    ]);
  });

  it("counts the API classes an empty operation surface was read from", () => {
    const error = XeroAtlasErrors.noOperations({ moduleCount: 11, packageName: "xero-node", version: "19.1.0" });
    expect(error.code).toBe("NO_OPERATIONS");
    expect(xeroAtlasErrorLines({ error })).toEqual([
      "xero-node 19.1.0 declared no operations across 11 API class(es)",
      "refusing to publish an empty API surface — an atlas that reports zero operations reads identically to one whose parser broke",
    ]);
  });

  it("refuses a surface with no model fields in two lines", () => {
    const error = XeroAtlasErrors.noModelFields({ packageName: "xero-node", version: "19.1.0" });
    expect(error.code).toBe("NO_MODEL_FIELDS");
    expect(xeroAtlasErrorLines({ error })).toEqual([
      "xero-node 19.1.0 declared no model fields, so no operation could say what it returns",
      "refusing to publish a surface with no response fields — the same silent-parser failure, one layer down",
    ]);
  });

  it("gives a list-carrying variant a message that is its lines joined, for a single-line display", () => {
    expect(XeroAtlasErrors.noModelFields({ packageName: "xero-node", version: "19.1.0" }).message).toBe(
      "xero-node 19.1.0 declared no model fields, so no operation could say what it returns; refusing to publish a surface with no response fields — the same silent-parser failure, one layer down",
    );
  });
});
