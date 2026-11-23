/**
 * The Notion atlas's typed failures: each factory's code and exact text, and the lines each one prints.
 *
 * A list-carrying variant must print one line per reason — the CLI iterates what the lines helper returns,
 * and printing the joined `message` there instead would fold the correction onto the refusal's own line.
 */
import { describe, expect, it } from "vitest";

import { NotionAtlasErrors, notionAtlasErrorLines } from "../../../../atlas/notion/errors.js";

describe("NotionAtlasErrors", () => {
  it("quotes the transport's message when the web client is unreachable", () => {
    const error = NotionAtlasErrors.clientUnreachable({ detail: "timed out" });
    expect(error.code).toBe("WEB_CLIENT_UNREACHABLE");
    expect(notionAtlasErrorLines({ error })).toEqual([
      "could not reach the Notion web client to learn its workspace: timed out",
    ]);
  });

  it("prints an unresolvable package and the install it needs as two lines", () => {
    const error = NotionAtlasErrors.sdkUnresolved({ cause: "boom", packageName: "@notionhq/client" });
    expect(error.code).toBe("SDK_UNRESOLVED");
    expect(notionAtlasErrorLines({ error })).toEqual([
      "could not resolve @notionhq/client: boom",
      "the API surface is read from the installed client, so this atlas cannot be synced without it — run `yarn install`",
    ]);
  });

  it("names the package when its package.json cannot be read", () => {
    const error = NotionAtlasErrors.packageJsonUnreadable({
      cause: new Error("EACCES"),
      packageName: "@notionhq/client",
    });
    expect(error.code).toBe("PACKAGE_JSON_UNREADABLE");
    expect(notionAtlasErrorLines({ error })).toEqual(["could not read @notionhq/client's package.json: EACCES"]);
  });

  it("names the package when it declares no version", () => {
    const error = NotionAtlasErrors.versionUndeclared({ packageName: "@notionhq/client" });
    expect(error.code).toBe("VERSION_UNDECLARED");
    expect(error.message).toBe(
      "@notionhq/client's package.json declares no version, so a stored generation could not name one",
    );
  });

  it("names the endpoint subpath and prints the layout correction as its own line", () => {
    const error = NotionAtlasErrors.endpointsUnlisted({
      cause: new Error("ENOENT"),
      packageName: "@notionhq/client",
      subpath: "build/src/api-endpoints",
    });
    expect(error.code).toBe("ENDPOINTS_UNLISTED");
    expect(notionAtlasErrorLines({ error })).toEqual([
      "could not list @notionhq/client's generated endpoint modules at build/src/api-endpoints: ENOENT",
      "the package's layout has moved; this atlas's API surface is read from those files and cannot be inferred",
    ]);
  });

  it("names the one endpoint module it could not read", () => {
    const error = NotionAtlasErrors.moduleUnreadable({
      cause: new Error("EISDIR"),
      file: "users.js",
      packageName: "@notionhq/client",
    });
    expect(error.code).toBe("ENDPOINT_MODULE_UNREADABLE");
    expect(notionAtlasErrorLines({ error })).toEqual(["could not read @notionhq/client's users.js: EISDIR"]);
  });

  it("counts the modules read and refuses the empty surface on its own line", () => {
    const error = NotionAtlasErrors.noEndpoints({ moduleCount: 3, packageName: "@notionhq/client", version: "5.0.0" });
    expect(error.code).toBe("NO_ENDPOINTS");
    expect(notionAtlasErrorLines({ error })).toEqual([
      "@notionhq/client 5.0.0 declared no endpoints across 3 module(s)",
      "refusing to publish an empty API surface — an atlas that reports zero endpoints reads identically to one whose parser broke",
    ]);
    expect(error.message).toBe(
      "@notionhq/client 5.0.0 declared no endpoints across 3 module(s); refusing to publish an empty API surface — an atlas that reports zero endpoints reads identically to one whose parser broke",
    );
  });

  it("names the refused tab and every id that exists", () => {
    const error = NotionAtlasErrors.tabUnknown({ id: "bogus", known: ["general", "members"] });
    expect(error.code).toBe("TAB_UNKNOWN");
    expect(notionAtlasErrorLines({ error })).toEqual([
      "--tab 'bogus' is not a tab this build knows; the closed set is general, members",
    ]);
  });
});
