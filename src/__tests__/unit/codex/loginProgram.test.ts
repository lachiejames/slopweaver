/**
 * The Tcl sign-in program's text, pinned where it carries an agreement with TypeScript: the request ids
 * `../../../codex/loginExchangeParse.ts` writes (start 2, account 3, cancel 4), the page-prefix check, and the
 * opener run as one argument through `exec`, never a shell. The subprocess lane runs the program itself.
 */
import { describe, expect, it } from "vitest";

import { LOGIN_PROGRAM } from "../../../codex/loginProgram.js";

describe("LOGIN_PROGRAM", () => {
  it("answers the sign-in start, the account read and the cancel by the ids the parser sends them under", () => {
    expect(LOGIN_PROGRAM).toContain(String.raw`regexp {"id":\s*2\s*[,\}]} $line`);
    expect(LOGIN_PROGRAM).toContain(String.raw`regexp {"id":\s*3\s*[,\}]} $line`);
    expect(LOGIN_PROGRAM).toContain(String.raw`regexp {"id":\s*4\s*[,\}]} $line`);
  });

  it("refuses a sign-in page outside the provider's prefix before opening anything", () => {
    expect(LOGIN_PROGRAM).toContain(
      "if {[string first $env(SLOPWEAVER_CODEX_LOGIN_URL_PREFIX) $url] != 0} { return url }",
    );
  });

  it("opens the page with the opener and the URL as one argument, never through a shell", () => {
    expect(LOGIN_PROGRAM).toContain("if {[catch {exec $opener $url}]} { return browser }");
    expect(LOGIN_PROGRAM).not.toContain("sh -c");
  });
});
