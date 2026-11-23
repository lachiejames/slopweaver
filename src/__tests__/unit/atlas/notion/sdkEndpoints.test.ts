import { describe, expect, it } from "vitest";

import { descriptionAbove, parseNotionSdkModule, pathTemplateOf } from "../../../../atlas/notion/sdkEndpoints.js";

/**
 * One generated module, in the exact shape `@notionhq/client` ships: a JSDoc line, then an
 * `exports.<name> = { … }` object carrying the method, the three parameter lists and the path template.
 */
const USERS_MODULE = `"use strict";
// cspell:disable-file
// Note: This is a generated file. DO NOT EDIT!
Object.defineProperty(exports, "__esModule", { value: true });
exports.listUsers = exports.getUser = exports.getSelf = void 0;
/**
 * Retrieve your token's bot user
 */
exports.getSelf = {
    method: "get",
    pathParams: [],
    queryParams: [],
    bodyParams: [],
    path: () => \`users/me\`,
};
/**
 * Retrieve a user
 */
exports.getUser = {
    method: "get",
    pathParams: ["user_id"],
    queryParams: [],
    bodyParams: [],
    path: (p) => \`users/\${p.user_id}\`,
};
/**
 * List all users
 */
exports.listUsers = {
    method: "get",
    pathParams: [],
    queryParams: ["start_cursor", "page_size"],
    bodyParams: [],
    path: () => \`users\`,
};
`;

describe("parseNotionSdkModule", () => {
  it("reads every endpoint a module declares, in source order", () => {
    const rows = parseNotionSdkModule({ module: "users", source: USERS_MODULE });
    expect(rows.map((row) => row.name)).toEqual(["getSelf", "getUser", "listUsers"]);
  });

  it("upper-cases the HTTP method the package spells in lower case", () => {
    const rows = parseNotionSdkModule({ module: "users", source: USERS_MODULE });
    expect(rows[0]!.httpMethod).toBe("GET");
  });

  it("carries the module name onto every row", () => {
    const rows = parseNotionSdkModule({ module: "users", source: USERS_MODULE });
    expect(rows.map((row) => row.module)).toEqual(["users", "users", "users"]);
  });

  it("rewrites a path interpolation to a named placeholder", () => {
    const rows = parseNotionSdkModule({ module: "users", source: USERS_MODULE });
    expect(rows[1]!.pathTemplate).toBe("users/{user_id}");
  });

  it("keeps a path with no interpolation verbatim", () => {
    const rows = parseNotionSdkModule({ module: "users", source: USERS_MODULE });
    expect(rows[0]!.pathTemplate).toBe("users/me");
  });

  it("reads the path parameter list", () => {
    const rows = parseNotionSdkModule({ module: "users", source: USERS_MODULE });
    expect(rows[1]!.pathParams).toEqual(["user_id"]);
  });

  it("reads a multi-member query parameter list", () => {
    const rows = parseNotionSdkModule({ module: "users", source: USERS_MODULE });
    expect(rows[2]!.queryParams).toEqual(["start_cursor", "page_size"]);
  });

  it("reads an empty parameter list as no members", () => {
    const rows = parseNotionSdkModule({ module: "users", source: USERS_MODULE });
    expect(rows[0]!.bodyParams).toEqual([]);
  });

  it("takes the description from the JSDoc block directly above the declaration", () => {
    const rows = parseNotionSdkModule({ module: "users", source: USERS_MODULE });
    expect(rows[1]!.description).toBe("Retrieve a user");
  });

  it("returns no rows for a module that declares no endpoints", () => {
    const source = `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n`;
    expect(parseNotionSdkModule({ module: "webhooks", source })).toEqual([]);
  });

  it("skips an export whose object declares no method, so a helper is not read as an endpoint", () => {
    const source = `\nexports.meetingNotesFilterableProperties = {\n    title: "text",\n};\n`;
    expect(parseNotionSdkModule({ module: "meeting-notes", source })).toEqual([]);
  });

  it("skips an export that is not an object literal at all", () => {
    const source = `\nexports.listUsers = void 0;\n`;
    expect(parseNotionSdkModule({ module: "users", source })).toEqual([]);
  });

  it("reads a path carrying two interpolations", () => {
    const source = [
      "",
      "exports.getPageProperty = {",
      '    method: "get",',
      '    pathParams: ["page_id", "property_id"],',
      "    queryParams: [],",
      "    bodyParams: [],",
      "    path: (p) => `pages/${p.page_id}/properties/${p.property_id}`,",
      "};",
      "",
    ].join("\n");
    const rows = parseNotionSdkModule({ module: "pages", source });
    expect(rows[0]!.pathTemplate).toBe("pages/{page_id}/properties/{property_id}");
  });

  it("reports a description of null when no JSDoc block sits directly above", () => {
    const source = [
      "",
      "exports.search = {",
      '    method: "post",',
      "    pathParams: [],",
      "    queryParams: [],",
      "    bodyParams: [],",
      "    path: () => `search`,",
      "};",
      "",
    ].join("\n");
    expect(parseNotionSdkModule({ module: "search", source })[0]!.description).toBeNull();
  });
});

describe("pathTemplateOf", () => {
  it("reports null when the object declares no path at all", () => {
    expect(pathTemplateOf({ body: '\n    method: "get",\n' })).toBeNull();
  });

  it("reports null when the path's template literal is never closed", () => {
    expect(pathTemplateOf({ body: "\n    path: () => `users" })).toBeNull();
  });

  it("leaves an interpolation it cannot read as a property access verbatim in place", () => {
    expect(pathTemplateOf({ body: "\n    path: () => `a/${suffix}`," })).toBe("a/{suffix}");
  });
});

describe("descriptionAbove", () => {
  it("reports null when a blank line separates the block from the declaration", () => {
    const text = "/**\n * Retrieve a user\n */\n\nexports.getUser = {";
    expect(descriptionAbove({ before: text.indexOf("exports."), text })).toBeNull();
  });

  it("skips the block's own empty lines to reach its first sentence", () => {
    const text = "/**\n *\n * Retrieve a user\n */\nexports.getUser = {";
    expect(descriptionAbove({ before: text.indexOf("exports."), text })).toBe("Retrieve a user");
  });

  it("reports null when nothing precedes the declaration", () => {
    const text = "exports.getUser = {";
    expect(descriptionAbove({ before: 0, text })).toBeNull();
  });
});
