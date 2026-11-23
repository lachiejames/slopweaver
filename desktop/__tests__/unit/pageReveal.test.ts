/**
 * A "Reveal in Finder" takes exactly one page's slug from the console window only, names its copy inside the
 * shell's own directory, and reveals a file only when `page export` says it wrote exactly that one.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import { exportAnswer, exportFileOf, pageToReveal, shellHomeOf } from "../../src/pageReveal";

const USER_HOME = "/Users/someone";
const FILE = "/private/tmp/slopweaver-reveal-abc/pir-briefing.html";

/** What `page export --json` prints for a document of this kind. */
function printed({ document }: { document: Record<string, unknown> }): string {
  return `${JSON.stringify({ schemaVersion: 1, slug: "pir-briefing", ...document })}\n`;
}

describe("shellHomeOf", () => {
  it("uses SLOPWEAVER_HOME when it is set, resolved and untrimmed, as the console does", () => {
    expect(shellHomeOf({ envHome: "/tmp/sw-home", userHome: USER_HOME })).toBe("/tmp/sw-home");
    expect(shellHomeOf({ envHome: "/tmp/sw-home/../other", userHome: USER_HOME })).toBe("/tmp/other");
    expect(shellHomeOf({ envHome: "/tmp/sw-home ", userHome: USER_HOME })).toBe("/tmp/sw-home ");
  });

  it("falls to ~/.slopweaver when SLOPWEAVER_HOME is unset, empty or blank", () => {
    for (const envHome of [undefined, "", "  "]) {
      expect(shellHomeOf({ envHome, userHome: USER_HOME })).toBe("/Users/someone/.slopweaver");
    }
  });
});

describe("pageToReveal", () => {
  it("takes every slug the page grammar allows, at both edges of its length", () => {
    const longest = `a${"b".repeat(127)}`;
    const slugs = ["a", "A9", "a.b_c-d", "pir-briefing", longest];
    expect(slugs.map((value) => unwrap(pageToReveal({ role: "main", value })))).toEqual(slugs);
  });

  it("refuses any window but the console's", () => {
    for (const role of ["overlay", undefined] as const) {
      expect(unwrapErr(pageToReveal({ role, value: "pir-briefing" }))).toBe(
        "only the console window may reveal a page in Finder",
      );
    }
  });

  it("refuses anything that is not exactly one page's slug", () => {
    const notSlugs: readonly unknown[] = [
      undefined,
      null,
      7,
      ["a"],
      { slug: "a" },
      "",
      "..",
      ".hidden",
      "-a",
      "a/b",
      "../a",
      "a\\b",
      "a b",
      "a\n",
      "café",
      `a${"b".repeat(128)}`,
    ];
    for (const value of notSlugs) {
      expect(unwrapErr(pageToReveal({ role: "main", value }))).toBe(
        "that is not a page's name, so there is no file to reveal",
      );
    }
  });
});

describe("exportFileOf", () => {
  it("names the copy for its page, inside the reveal's own directory", () => {
    expect(exportFileOf({ dir: "/private/tmp/slopweaver-reveal-abc", slug: "pir-briefing" })).toBe(FILE);
  });
});

describe("exportAnswer", () => {
  it("reveals the file when the export says it wrote exactly that one", () => {
    const stdout = printed({ document: { kind: "exported", path: FILE } });
    expect(unwrap(exportAnswer({ code: 0, file: FILE, slug: "pir-briefing", stdout }))).toBe(FILE);
  });

  it("says a page the store does not hold is not there, and a store that cannot say is unreadable", () => {
    const notFound = printed({ document: { kind: "not-found" } });
    const unreadable = printed({ document: { code: "STORE_QUERY_FAILED", kind: "store-unreadable", message: "x" } });
    expect(unwrapErr(exportAnswer({ code: 3, file: FILE, slug: "pir-briefing", stdout: notFound }))).toBe(
      'the page "pir-briefing" is not in the store, so there is nothing to reveal',
    );
    expect(unwrapErr(exportAnswer({ code: 1, file: FILE, slug: "pir-briefing", stdout: unreadable }))).toBe(
      'the store could not be read, so the page "pir-briefing" could not be copied out',
    );
  });

  it("reveals nothing for another file, a failed write, a non-zero exit or output that is no document", () => {
    const answers = [
      { code: 0, stdout: printed({ document: { kind: "exported", path: "/Users/someone/elsewhere.html" } }) },
      { code: 1, stdout: printed({ document: { kind: "write-failed", message: "EEXIST", path: FILE } }) },
      { code: 1, stdout: printed({ document: { kind: "exported", path: FILE } }) },
      { code: 0, stdout: "" },
      { code: 0, stdout: "null" },
    ];
    expect(
      answers.map(({ code, stdout }) => unwrapErr(exportAnswer({ code, file: FILE, slug: "pir-briefing", stdout }))),
    ).toEqual(answers.map(() => 'the page "pir-briefing" could not be copied out of the store'));
  });
});
