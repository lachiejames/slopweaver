import { stripVTControlCharacters } from "node:util";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import type { ClaudeIdentityAssertion } from "../../../claude/identityAssertions.js";
import {
  captureScript,
  hintedAuthorizeUrl,
  MINT_PTY_PROGRAM,
  mintAddress,
  mintHandoffLines,
  mintPtyReportOf,
  mintPtyRequestOf,
  setupTokenFromScreen,
  tokenFromMint,
} from "../../../claude/mintFlow.js";

/** A synthetic setup token, long enough to wrap at 80 columns. Not a credential. */
const TOKEN = `sk-ant-oat01-${"abcdefghij".repeat(9)}-xyzAA`;

/** A second synthetic token, for the render that should win. */
const LATER = `sk-ant-oat01-${"klmnopqrst".repeat(9)}-uvwAA`;

const ADDRESS = "plan-two@example.invalid";

/** The query the automatic flow's URL carries, with its localhost callback. */
const AUTOMATIC_QUERY =
  "code=true&client_id=client-synthetic&response_type=code" +
  "&redirect_uri=http%3A%2F%2Flocalhost%3A54545%2Fcallback&scope=user%3Ainference" +
  "&code_challenge=abc_def-ghi&code_challenge_method=S256&state=state_synthetic";

/** The automatic authorize URL `claude setup-token` hands `$BROWSER`, synthetic ids throughout. */
const AUTOMATIC = `https://claude.com/cai/oauth/authorize?${AUTOMATIC_QUERY}`;

/** The MANUAL flow's URL: same page, but a hosted callback that needs a code pasted back. */
const MANUAL = AUTOMATIC.replace(
  "http%3A%2F%2Flocalhost%3A54545%2Fcallback",
  "https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback",
);

const hint = ({ captured, allowUnexpectedHost = false }: { captured: string; allowUnexpectedHost?: boolean }) =>
  hintedAuthorizeUrl({ address: ADDRESS, allowUnexpectedHost, captured });

describe("hintedAuthorizeUrl", () => {
  it("appends the address to the captured string EXACTLY, never re-serialising it", () => {
    expect(unwrap(hint({ captured: AUTOMATIC }))).toBe(`${AUTOMATIC}&login_hint=plan-two%40example.invalid`);
  });

  it("encodes an address a query would otherwise split", () => {
    const hinted = hintedAuthorizeUrl({
      address: "a+b@example.invalid",
      allowUnexpectedHost: false,
      captured: AUTOMATIC,
    });
    expect(unwrap(hinted)).toBe(`${AUTOMATIC}&login_hint=a%2Bb%40example.invalid`);
  });

  it("accepts a 127.0.0.1 callback as the same automatic flow", () => {
    const captured = AUTOMATIC.replace("localhost", "127.0.0.1");
    expect(unwrap(hint({ captured }))).toBe(`${captured}&login_hint=plan-two%40example.invalid`);
  });

  it("refuses the MANUAL flow, whose hosted callback would need a code pasted back", () => {
    expect(unwrapErr(hint({ captured: MANUAL })).because).toBe("redirect-not-localhost");
  });

  it("still refuses the manual flow with the host hatch open, because the hatch is about the host alone", () => {
    expect(unwrapErr(hint({ allowUnexpectedHost: true, captured: MANUAL })).because).toBe("redirect-not-localhost");
  });

  it("refuses a callback on localhost at the wrong path, or over https", () => {
    const wrongPath = AUTOMATIC.replace("%2Fcallback", "%2Fother");
    const overHttps = AUTOMATIC.replace("http%3A%2F%2Flocalhost", "https%3A%2F%2Flocalhost");
    expect(unwrapErr(hint({ captured: wrongPath })).because).toBe("redirect-not-localhost");
    expect(unwrapErr(hint({ captured: overHttps })).because).toBe("redirect-not-localhost");
  });

  it("refuses a URL with no redirect_uri at all", () => {
    const captured = "https://claude.com/cai/oauth/authorize?code=true&state=state_synthetic";
    expect(unwrapErr(hint({ captured })).because).toBe("redirect-not-localhost");
  });

  it("refuses an unexpected host with the hatch's refusal, and accepts it once the hatch is open", () => {
    const captured = AUTOMATIC.replace("https://claude.com", "https://auth.example.com");
    const error = unwrapErr(hint({ captured }));
    expect(error.code).toBe("MINT_AUTHORIZE_URL_UNEXPECTED");
    expect(error.because).toBe("host");
    expect(error.message).toContain("SLOPWEAVER_ALLOW_CLAUDE_MINT_AUTHORIZE_HOST=1");
    expect(unwrap(hint({ allowUnexpectedHost: true, captured }))).toBe(
      `${captured}&login_hint=plan-two%40example.invalid`,
    );
  });

  it("refuses a URL that is not https", () => {
    expect(unwrapErr(hint({ captured: AUTOMATIC.replace("https:", "http:") })).because).toBe("not-https");
  });

  it("refuses a path other than the authorize page", () => {
    expect(unwrapErr(hint({ captured: AUTOMATIC.replace("/cai/oauth/", "/oauth/") })).because).toBe("path");
  });

  it("refuses a URL that already carries a login_hint", () => {
    expect(unwrapErr(hint({ captured: `${AUTOMATIC}&login_hint=other%40example.invalid` })).because).toBe(
      "hint-present",
    );
  });

  it("refuses what does not parse as a URL at all", () => {
    expect(unwrapErr(hint({ captured: "not a url" })).because).toBe("unparseable");
  });
});

describe("mintAddress", () => {
  const assertion = ({ email }: { email?: string }): ClaudeIdentityAssertion => ({
    alias: "plan-two",
    assertedAtIso: "2026-09-10T00:00:00.000Z",
    organizationId: "org-plan-two",
    ...(email === undefined ? {} : { email }),
  });

  it("answers the address the enrollment bound", () => {
    expect(unwrap(mintAddress({ alias: "plan-two", assertions: [assertion({ email: ADDRESS })] }))).toBe(ADDRESS);
  });

  it("refuses a plan enrolled with no address, naming it as enrolled", () => {
    const error = unwrapErr(mintAddress({ alias: "plan-two", assertions: [assertion({})] }));
    expect(error.code).toBe("MINT_ADDRESS_UNBOUND");
    expect(error.message).toContain("--reenroll plan-two");
  });

  it("refuses a plan nobody enrolled, naming the sign-in that enrols it", () => {
    const error = unwrapErr(mintAddress({ alias: "plan-nine", assertions: [assertion({ email: ADDRESS })] }));
    expect(error.code).toBe("MINT_ADDRESS_UNBOUND");
    expect(error.message).toContain("signin --plan plan-nine");
  });
});

describe("setupTokenFromScreen", () => {
  it("reads a token printed plainly", () => {
    const screen = `Your OAuth token (valid for 1 year):\r\n\r\n${TOKEN}\r\n\r\nStore this token securely.\r\n`;
    expect(unwrap(setupTokenFromScreen({ screen }))).toBe(TOKEN);
  });

  it("reads a token through the colour and cursor escapes a terminal renderer writes", () => {
    const screen = `\u001b[2K\u001b[1A\u001b[G  \u001b[32m${TOKEN}\u001b[39m\r\n\u001b[2mStore this token securely.\u001b[22m\r\n`;
    expect(unwrap(setupTokenFromScreen({ screen }))).toBe(TOKEN);
  });

  it("re-joins a token wrapped at 80 columns with an indented continuation", () => {
    const screen = `  ${TOKEN.slice(0, 78)}\r\n  ${TOKEN.slice(78)}\r\n\r\nStore this token securely.\r\n`;
    expect(TOKEN.length).toBeGreaterThan(78);
    expect(unwrap(setupTokenFromScreen({ screen }))).toBe(TOKEN);
  });

  it("never glues the prose on the next line onto a token", () => {
    const screen = `${TOKEN}\nStore this token securely.\n`;
    expect(unwrap(setupTokenFromScreen({ screen }))).toBe(TOKEN);
  });

  it("keeps a token cell the renderer SKIPPED because the old frame already held that character there", () => {
    // The plan-two 401: a cell-diff renderer overdraws the previous frame and jumps (`ESC[nG`) over
    // every cell that already matches. Stripping the jump drops the character; replaying the screen keeps it.
    const skipped = 20;
    const previous = `${"X".repeat(skipped)}${TOKEN[skipped]!}${"X".repeat(TOKEN.length - skipped - 1)}`;
    const overdraw = `${TOKEN.slice(0, skipped)}\u001b[${String(skipped + 2)}G${TOKEN.slice(skipped + 1)}`;
    const screen = `${previous}\r\r\n\r\u001b[1A${overdraw}\r\r\n`;
    expect(stripVTControlCharacters(screen)).not.toContain(TOKEN);
    expect(unwrap(setupTokenFromScreen({ screen }))).toBe(TOKEN);
  });

  it("takes the LAST render when the screen printed the token twice", () => {
    const screen = `${TOKEN}\r\n\u001b[2K\u001b[1A${LATER}\r\n`;
    expect(unwrap(setupTokenFromScreen({ screen }))).toBe(LATER);
  });

  it("answers MINT_NO_TOKEN when the screen carried none", () => {
    expect(unwrapErr(setupTokenFromScreen({ screen: "Opening browser to sign in…\r\n" })).code).toBe("MINT_NO_TOKEN");
  });
});

describe("tokenFromMint", () => {
  const screen = `${TOKEN}\r\n`;

  it("reads the token when the program saw it", () => {
    expect(unwrap(tokenFromMint({ report: { hung: false, status: 0, stderrTail: "" }, screen }))).toBe(TOKEN);
  });

  it("still reads a token that landed in the second the deadline fired", () => {
    expect(unwrap(tokenFromMint({ report: { hung: false, status: 2, stderrTail: "" }, screen }))).toBe(TOKEN);
  });

  it("names a deadline with no token on screen as the token wait expiring", () => {
    const error = unwrapErr(tokenFromMint({ report: { hung: false, status: 2, stderrTail: "" }, screen: "" }));
    expect(error.code).toBe("MINT_TIMED_OUT");
  });

  it("names a login that exited with no token as MINT_NO_TOKEN", () => {
    const error = unwrapErr(tokenFromMint({ report: { hung: false, status: 3, stderrTail: "" }, screen: "" }));
    expect(error.code).toBe("MINT_NO_TOKEN");
  });

  it("names an abort, a hang and a Tcl error as the pty failing, and never reads the screen for them", () => {
    const aborted = unwrapErr(tokenFromMint({ report: { hung: false, status: 4, stderrTail: "" }, screen }));
    const hung = unwrapErr(tokenFromMint({ report: { hung: true, status: null, stderrTail: "" }, screen }));
    const broken = unwrapErr(
      tokenFromMint({ report: { hung: false, status: 1, stderrTail: 'invalid command name "spwan"\n' }, screen }),
    );
    expect(aborted.code).toBe("MINT_PTY_FAILED");
    expect(hung.code).toBe("MINT_PTY_FAILED");
    expect(broken.message).toBe(
      'the terminal the mint ran in failed (expect exited 1: invalid command name "spwan") — nothing was written',
    );
  });
});

describe("captureScript", () => {
  it("records the URL through a .part file and a rename, opening nothing", () => {
    expect(captureScript({ urlPath: "/tmp/mint/authorize-url" })).toBe(
      "#!/bin/sh\nprintf '%s' \"$1\" > /tmp/mint/authorize-url.part && mv /tmp/mint/authorize-url.part /tmp/mint/authorize-url\n",
    );
  });

  it("quotes a path a shell would otherwise split", () => {
    expect(captureScript({ urlPath: "/tmp/my mint/url" })).toBe(
      "#!/bin/sh\nprintf '%s' \"$1\" > '/tmp/my mint/url.part' && mv '/tmp/my mint/url.part' '/tmp/my mint/url'\n",
    );
  });
});

describe("MINT_PTY_PROGRAM", () => {
  it("spawns whatever argv it is handed, and names no model runner itself", () => {
    expect(MINT_PTY_PROGRAM).toContain("spawn -noecho {*}$argv");
    expect(MINT_PTY_PROGRAM).toContain("log_user 0");
    expect(MINT_PTY_PROGRAM).toContain("log_file -a $env(SLOPWEAVER_MINT_SCREEN_LOG)");
    expect(MINT_PTY_PROGRAM).not.toContain("claude");
  });
});

describe("mintHandoffLines", () => {
  it("puts the hinted URL alone on its own line, between two short lines naming the plan", () => {
    const lines = mintHandoffLines({ address: ADDRESS, alias: "plan-two", hintedUrl: "https://claude.com/x" });
    expect(lines).toEqual([
      "mint plan-two: open this in the browser signed into plan-two@example.invalid — the address is pre-filled; press Continue, then Authorize",
      "https://claude.com/x",
      "mint plan-two: waiting for the login to print the token — nothing is pasted, and it is written only once it proves itself",
    ]);
  });
});

describe("mintPtyRequestOf", () => {
  it("passes a whole mint request through", () => {
    const value = { argv: ["claude", "setup-token"], env: { PATH: "/usr/bin" }, programPath: "/m/p.exp", timeoutMs: 5 };

    expect(mintPtyRequestOf({ value })).toEqual(value);
  });

  it("throws on workerData that is not an object", () => {
    expect(() => mintPtyRequestOf({ value: null })).toThrow("claude mint worker: workerData was not an object");
  });

  it("throws on an object missing a field", () => {
    const value = { argv: ["claude", "setup-token"], env: {}, programPath: "/m/p.exp" };

    expect(() => mintPtyRequestOf({ value })).toThrow("claude mint worker: workerData did not carry a mint request");
  });
});

describe("mintPtyReportOf", () => {
  it("reports a clean exit with expect's own stderr", () => {
    expect(mintPtyReportOf({ error: undefined, status: 0, stderr: "warning\n" })).toEqual({
      hung: false,
      status: 0,
      stderrTail: "warning\n",
    });
  });

  it("marks the report hung when spawnSync's own ceiling killed expect", () => {
    const error = Object.assign(new Error("spawnSync /usr/bin/expect ETIMEDOUT"), { code: "ETIMEDOUT" });

    expect(mintPtyReportOf({ error, status: null, stderr: "" })).toEqual({
      hung: true,
      status: null,
      stderrTail: "spawnSync /usr/bin/expect ETIMEDOUT",
    });
  });

  it("carries a spawn failure that is not a timeout, and reads a missing stderr as empty", () => {
    const error = Object.assign(new Error("spawnSync /usr/bin/expect ENOENT"), { code: "ENOENT" });

    expect(mintPtyReportOf({ error, status: null, stderr: null })).toEqual({
      hung: false,
      status: null,
      stderrTail: "spawnSync /usr/bin/expect ENOENT",
    });
  });

  it("keeps only the last 400 characters", () => {
    const report = mintPtyReportOf({ error: undefined, status: 1, stderr: `${"a".repeat(100)}${"b".repeat(400)}` });

    expect(report.stderrTail).toBe("b".repeat(400));
  });
});
