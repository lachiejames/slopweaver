// The legacy-verdict case went out with the fold that read it.
// deleted-with-code: OWNER_HANDS_SPELLING
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendSignInProbe,
  OWNER_HANDS_VERDICT,
  parseSignInProbeLine,
  probePage,
  readSignInProbes,
  SignInProbeErrors,
  type SignInProbeRow,
} from "../../../browser/signInProbeStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

const ROW: SignInProbeRow = {
  atIso: "2026-10-06T10:50:00.000Z",
  page: "https://app.datadoghq.com/apm/home",
  provider: "datadog",
  verdict: "signed-in",
  why: "the console opened at https://app.datadoghq.com/apm/home",
};

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("probePage", () => {
  it("keeps origin and path, dropping a query that may carry a token", () => {
    expect(probePage({ url: "https://github.com/orgs/acme/sso?return_to=%2Fx&state=abc" })).toBe(
      "https://github.com/orgs/acme/sso",
    );
  });
});

describe("parseSignInProbeLine", () => {
  it("decodes a well-formed row", () => {
    expect(parseSignInProbeLine({ line: JSON.stringify(ROW) })).toEqual(ROW);
  });

  it("skips a torn line", () => {
    expect(parseSignInProbeLine({ line: '{"provider":"datadog","verd' })).toBeUndefined();
  });

  it("skips a provider the fleet does not sign in to", () => {
    expect(parseSignInProbeLine({ line: JSON.stringify({ ...ROW, provider: "trelica" }) })).toBeUndefined();
  });

  it("skips a row whose instant does not parse", () => {
    expect(parseSignInProbeLine({ line: JSON.stringify({ ...ROW, atIso: "yesterday" }) })).toBeUndefined();
  });

  it("decodes a look whose verdict is the owner's own step", () => {
    expect(parseSignInProbeLine({ line: JSON.stringify({ ...ROW, verdict: OWNER_HANDS_VERDICT }) })).toEqual({
      ...ROW,
      verdict: "owner-hands",
    });
  });

  it("skips a verdict outside the closed set", () => {
    expect(parseSignInProbeLine({ line: JSON.stringify({ ...ROW, verdict: "someone-else" }) })).toBeUndefined();
  });
});

describe("the ledger round trip", () => {
  it("reads a never-written ledger as empty", () => {
    const home = mkdtempSync(join(tmpdir(), "sip-"));
    homes.push(home);

    expect(unwrap(readSignInProbes({ home }))).toEqual([]);
  });

  it("reads back what it appended, in order, owner-only", () => {
    const home = mkdtempSync(join(tmpdir(), "sip-"));
    homes.push(home);
    const second: SignInProbeRow = {
      ...ROW,
      atIso: "2026-10-06T11:00:00.000Z",
      verdict: "owner-hands",
      why: "a passkey",
    };
    unwrap(appendSignInProbe({ home, row: ROW }));
    unwrap(appendSignInProbe({ home, row: second }));

    expect(unwrap(readSignInProbes({ home }))).toEqual([ROW, second]);
    expect(statSync(stateHomePaths({ home }).signInProbesJsonl).mode & 0o777).toBe(0o600);
  });
});

describe("a ledger that cannot be used", () => {
  it("names an existing ledger it cannot read", () => {
    const home = mkdtempSync(join(tmpdir(), "sip-"));
    homes.push(home);
    const path = stateHomePaths({ home }).signInProbesJsonl;
    mkdirSync(path, { recursive: true });

    const failure = unwrapErr(readSignInProbes({ home }));

    expect(failure.code).toBe(SignInProbeErrors.ledgerUnreadable({ cause: new Error("x"), path }).code);
    expect(failure.path).toBe(path);
  });

  it("names a look it could not record", () => {
    const home = mkdtempSync(join(tmpdir(), "sip-"));
    homes.push(home);
    const path = stateHomePaths({ home }).signInProbesJsonl;
    mkdirSync(path, { recursive: true });

    const failure = unwrapErr(appendSignInProbe({ home, row: ROW }));

    expect(failure.code).toBe(SignInProbeErrors.recordFailed({ cause: new Error("x"), path }).code);
    expect(failure.message).toContain(path);
  });
});
