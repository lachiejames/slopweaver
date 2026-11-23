import { describe, expect, it } from "vitest";

import { parseDrivenSession } from "../../../../atlas/slackApi/drivenSession.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { walkedPage } from "./slackAtlasFixtures.js";

const SOURCE = "/tmp/walk.json";
const session = { pages: [walkedPage()], unreachable: [], workspaceId: "T0SYN1ABCDEFGH" };

describe("parseDrivenSession", () => {
  it("reads a well-formed walk document", () => {
    const parsed = unwrap(parseDrivenSession({ json: JSON.stringify(session), source: SOURCE }));
    expect(parsed.workspaceId).toBe("T0SYN1ABCDEFGH");
    expect(parsed.pages.length).toBe(1);
  });

  it("carries an unreachable page through, so a gap stays a gap", () => {
    const json = JSON.stringify({ ...session, unreachable: [{ path: "/client/T01/x", reason: "404" }] });
    expect(unwrap(parseDrivenSession({ json, source: SOURCE })).unreachable[0]!.reason).toBe("404");
  });

  it("names the file when the document will not parse", () => {
    const result = parseDrivenSession({ json: "not json", source: SOURCE });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain(SOURCE);
  });

  it("quotes the parser's own reason after the file name, as one line", () => {
    expect(unwrapErr(parseDrivenSession({ json: "not json", source: SOURCE }))).toEqual([
      "/tmp/walk.json is not valid JSON: Unexpected token 'o', \"not json\" is not valid JSON",
    ]);
  });

  it("REFUSES a document that describes nothing, rather than publishing an empty surface", () => {
    // The failure this prevents: a generation claiming the web client calls no method at all.
    const result = parseDrivenSession({ json: "{}", source: SOURCE });
    expect(unwrapErr(result)).toEqual([
      `${SOURCE}: pages Invalid input: expected array, received undefined`,
      `${SOURCE}: unreachable Invalid input: expected array, received undefined`,
      `${SOURCE}: workspaceId Invalid input: expected string, received undefined`,
    ]);
  });

  it("refuses a page missing a field the projection reads", () => {
    const json = JSON.stringify({ ...session, pages: [{ path: "/client/T01/x" }] });
    const result = parseDrivenSession({ json, source: SOURCE });
    expect(unwrapErr(result)).toEqual([
      `${SOURCE}: pages.0.calls Invalid input: expected array, received undefined`,
      `${SOURCE}: pages.0.observedAt Invalid input: expected string, received undefined`,
      `${SOURCE}: pages.0.screenshotMissingBecause Invalid input: expected string, received undefined`,
      `${SOURCE}: pages.0.screenshotPath Invalid input: expected string, received undefined`,
      `${SOURCE}: pages.0.title Invalid input: expected string, received undefined`,
      `${SOURCE}: pages.0.url Invalid input: expected string, received undefined`,
    ]);
  });

  it("accepts a page that was reached but not photographed", () => {
    const json = JSON.stringify({ ...session, pages: [{ ...walkedPage(), screenshotPath: null }] });
    expect(unwrap(parseDrivenSession({ json, source: SOURCE })).pages[0]!.screenshotPath).toBe(null);
  });

  it("refuses an artifact reference where a local path belongs — a document cannot hand in its own digest", () => {
    const shot = { byteLength: 1, kind: "page-png", mediaType: "image/png", relativePath: "a.png", sha256: "b" };
    const json = JSON.stringify({ ...session, pages: [{ ...walkedPage(), screenshotPath: shot }] });
    const result = parseDrivenSession({ json, source: SOURCE });
    expect(unwrapErr(result)).toEqual([
      `${SOURCE}: pages.0.screenshotPath Invalid input: expected string, received object`,
    ]);
  });
});
