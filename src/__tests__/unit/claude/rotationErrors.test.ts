import { describe, expect, it } from "vitest";

import { ClaudeRotationErrors } from "../../../claude/errors.js";
import { MintErrors } from "../../../claude/mintErrors.js";

describe("probeTransportFailed", () => {
  it("names the plan whose probe never got an answer", () => {
    const error = ClaudeRotationErrors.probeTransportFailed({ alias: "plan-two" });
    expect(error.code).toBe("PROBE_TRANSPORT_FAILED");
    expect(error.alias).toBe("plan-two");
  });

  it("says this is the network and that no refresh follows, so a dead link is not read as a dead credential", () => {
    // The distinction this variant exists for. A transport failure that read as a refusal would send the gate
    // into one refresh command per store per spawn against a network that is answering nothing at all — the
    // owner's own named case: "if I happen to close my laptop for a day or my internet out for a day".
    const error = ClaudeRotationErrors.probeTransportFailed({ alias: "plan-two" });
    expect(error.message).toContain("this is the network, not a refusal");
    expect(error.message).toContain("no refresh is attempted");
  });
});

describe("accountConfigUnreadable", () => {
  it("names the file, so a reader can go and look at the thing that would not read", () => {
    const error = ClaudeRotationErrors.accountConfigUnreadable({ path: "/home/claude-accounts/accounts.json" });
    expect(error.code).toBe("ACCOUNT_CONFIG_UNREADABLE");
    expect(error.path).toBe("/home/claude-accounts/accounts.json");
    expect(error.message).toContain("/home/claude-accounts/accounts.json");
  });

  it("says the plans are UNKNOWN and that it refuses rather than booting on an ambient credential", () => {
    // Distinct from `accountConfigInvalid` on purpose: a file that is PRESENT and will not read is not the
    // same as one that read fine and holds nonsense, and it is not the same as no file at all — which is a
    // legitimate install and the gate's one remaining fall-through.
    const error = ClaudeRotationErrors.accountConfigUnreadable({ path: "/home/claude-accounts/accounts.json" });
    expect(error.message).toContain("UNKNOWN");
    expect(error.message).toContain("refusing rather than booting");
  });
});

describe("accountConfigStoreUnavailable", () => {
  it("carries the store's own outage message under a code of its own, distinct from an unreadable file", () => {
    const error = ClaudeRotationErrors.accountConfigStoreUnavailable({ message: "the store could not be opened" });
    expect(error.code).toBe("ACCOUNT_CONFIG_STORE_UNAVAILABLE");
    expect(error.message).toBe("the store could not be opened");
  });
});

describe("credentialRejected", () => {
  it("carries the alias and the status, which is what separates a refusal from an unread shape", () => {
    const error = ClaudeRotationErrors.credentialRejected({ alias: "plan-three", status: 401 });
    expect(error.code).toBe("CREDENTIAL_REJECTED");
    expect(error.alias).toBe("plan-three");
    expect(error.status).toBe(401);
  });

  it("points at the grant's own expiry rather than claiming a second refusal proves anything", () => {
    // The old wording told the reader that "a store that still refuses has nothing left to refresh from and
    // needs one browser sign-in". That is a diagnosis this code cannot make: a refusal after one attempt says
    // nothing about the refresh grant, whose expiry is a readable fact and was weeks out on every store when
    // this was measured.
    const error = ClaudeRotationErrors.credentialRejected({ alias: "plan-three", status: 403 });
    expect(error.message).toContain("repairs this on demand");
    expect(error.message).toContain("one further refusal is not a diagnosis of that grant");
  });
});

describe("the mint's failure kinds", () => {
  it("constructs every mint kind through the rotation factory, which carries mintErrors.ts's own", () => {
    expect(Object.keys(MintErrors).length).toBeGreaterThan(0);
    expect(Object.keys(MintErrors).filter((name) => !(name in ClaudeRotationErrors))).toEqual([]);
    expect(ClaudeRotationErrors.mintNoToken).toBe(MintErrors.mintNoToken);
  });

  it("names signin --plan for a plan nobody has enrolled, and refuses the cache in the same breath", () => {
    const error = ClaudeRotationErrors.mintAddressUnbound({ alias: "plan-two", enrolled: false });
    expect(error.code).toBe("MINT_ADDRESS_UNBOUND");
    expect(error.enrolled).toBe(false);
    expect(error.message).toContain("`slopweaver claude signin --plan plan-two`");
    expect(error.message).toContain("never pre-fills the unverified accounts.json cache");
  });

  it("names signin --reenroll for a plan enrolled before addresses were bound", () => {
    const error = ClaudeRotationErrors.mintAddressUnbound({ alias: "plan-two", enrolled: true });
    expect(error.enrolled).toBe(true);
    expect(error.message).toContain("`slopweaver claude signin --reenroll plan-two`");
  });

  it("renders an unexpected authorize HOST as the registered hatch's four-line refusal", () => {
    const error = ClaudeRotationErrors.mintAuthorizeUrlUnexpected({ because: "host", host: "evil.example" });
    expect(error.code).toBe("MINT_AUTHORIZE_URL_UNEXPECTED");
    expect(error.because).toBe("host");
    const lines = error.message.split("\n");
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("slopweaver claude mint blocked because");
    expect(lines[0]).toContain("(it named evil.example)");
    expect(lines[2]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_CLAUDE_MINT_AUTHORIZE_HOST=1 slopweaver claude mint.",
    );
  });

  it("calls the manual flow what it is, since it would need a code pasted back", () => {
    const error = ClaudeRotationErrors.mintAuthorizeUrlUnexpected({ because: "redirect-not-localhost" });
    expect(error.message).toContain("MANUAL flow");
  });

  it("says which wait expired", () => {
    expect(ClaudeRotationErrors.mintTimedOut({ stage: "authorize-url" }).message).toContain("authorize URL");
    expect(ClaudeRotationErrors.mintTimedOut({ stage: "token" }).message).toContain("before its deadline");
  });

  it("carries the judge's own lines as an unproven token's message", () => {
    const error = ClaudeRotationErrors.setupTokenUnproven({
      alias: "plan-two",
      lines: ["plan-two: setup token NOT written — the response carried no Fable week"],
    });
    expect(error.code).toBe("SETUP_TOKEN_UNPROVEN");
    expect(error.message).toBe("plan-two: setup token NOT written — the response carried no Fable week");
  });

  it("prefixes argument problems with the one shape the verb takes", () => {
    expect(ClaudeRotationErrors.mintArgsInvalid({ problems: ["--plan was not passed"] }).message).toBe(
      "claude mint takes --plan <alias>: --plan was not passed",
    );
  });
});
