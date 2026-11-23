/**
 * Unit: the mail door's scope table read through the shared Google helpers — the per-verb mapping, and the
 * two implication rules Google's own model actually has.
 */
import { describe, expect, it } from "vitest";
import { GMAIL_SCOPE_TABLE, GMAIL_SCOPES, VERB_CAPABILITIES } from "../../../../live/gmail/scopes.js";
import {
  missingScopes,
  parseGrantedScopes,
  satisfiesCapability,
  scopesToRequest,
} from "../../../../live/google/scopes.js";

describe("parseGrantedScopes", () => {
  it("splits a space-separated scope string", () => {
    expect(parseGrantedScopes({ scope: `${GMAIL_SCOPES.read} ${GMAIL_SCOPES.identity}` })).toStrictEqual([
      GMAIL_SCOPES.read,
      GMAIL_SCOPES.identity,
    ]);
  });

  it("deduplicates a repeated scope", () => {
    expect(parseGrantedScopes({ scope: `${GMAIL_SCOPES.read} ${GMAIL_SCOPES.read}` })).toStrictEqual([
      GMAIL_SCOPES.read,
    ]);
  });

  it("is empty when the response carried no scope at all", () => {
    expect(parseGrantedScopes({ scope: undefined })).toStrictEqual([]);
  });

  it("is empty for a blank scope string rather than yielding one empty entry", () => {
    expect(parseGrantedScopes({ scope: "   " })).toStrictEqual([]);
  });
});

describe("satisfiesCapability", () => {
  it("accepts gmail.modify for a read requirement, because modify subsumes readonly", () => {
    expect(satisfiesCapability({ capability: "read", granted: [GMAIL_SCOPES.modify], table: GMAIL_SCOPE_TABLE })).toBe(
      true,
    );
  });

  it("does NOT accept gmail.readonly for a modify requirement", () => {
    expect(satisfiesCapability({ capability: "modify", granted: [GMAIL_SCOPES.read], table: GMAIL_SCOPE_TABLE })).toBe(
      false,
    );
  });

  it("does NOT accept gmail.send for a compose requirement — they are separate grants", () => {
    expect(satisfiesCapability({ capability: "compose", granted: [GMAIL_SCOPES.send], table: GMAIL_SCOPE_TABLE })).toBe(
      false,
    );
  });

  it("does NOT accept gmail.compose for a send requirement either", () => {
    expect(satisfiesCapability({ capability: "send", granted: [GMAIL_SCOPES.compose], table: GMAIL_SCOPE_TABLE })).toBe(
      false,
    );
  });

  it("accepts the capability's own scope", () => {
    expect(satisfiesCapability({ capability: "send", granted: [GMAIL_SCOPES.send], table: GMAIL_SCOPE_TABLE })).toBe(
      true,
    );
  });
});

describe("missingScopes", () => {
  it("names the primary scope of each unsatisfied capability, in declaration order", () => {
    expect(
      missingScopes({ capabilities: ["read", "send"], granted: [GMAIL_SCOPES.modify], table: GMAIL_SCOPE_TABLE }),
    ).toStrictEqual([GMAIL_SCOPES.send]);
  });

  it("is empty when every capability is covered", () => {
    expect(
      missingScopes({ capabilities: ["read", "modify"], granted: [GMAIL_SCOPES.modify], table: GMAIL_SCOPE_TABLE }),
    ).toStrictEqual([]);
  });

  it("names every capability when nothing was granted", () => {
    expect(missingScopes({ capabilities: ["read", "compose"], granted: [], table: GMAIL_SCOPE_TABLE })).toStrictEqual([
      GMAIL_SCOPES.read,
      GMAIL_SCOPES.compose,
    ]);
  });
});

describe("scopesToRequest", () => {
  it("always leads with identity, so connect can name the mailbox it bound to", () => {
    expect(scopesToRequest({ capabilities: ["read"], table: GMAIL_SCOPE_TABLE })).toStrictEqual([
      GMAIL_SCOPES.identity,
      GMAIL_SCOPES.read,
    ]);
  });

  it("does not duplicate identity when it was asked for explicitly", () => {
    expect(scopesToRequest({ capabilities: ["identity", "read"], table: GMAIL_SCOPE_TABLE })).toStrictEqual([
      GMAIL_SCOPES.identity,
      GMAIL_SCOPES.read,
    ]);
  });
});

describe("VERB_CAPABILITIES", () => {
  it("keeps the two read verbs on the narrowest capability", () => {
    expect(VERB_CAPABILITIES["list"]).toStrictEqual(["read"]);
    expect(VERB_CAPABILITIES["read"]).toStrictEqual(["read"]);
  });

  it("keeps fetching an attachment on read — saving its bytes locally changes nothing in the mailbox", () => {
    expect(VERB_CAPABILITIES["attachment"]).toStrictEqual(["read"]);
  });

  it("puts drafting on compose and sending on send, never on one shared grant", () => {
    expect(VERB_CAPABILITIES["draft"]).toStrictEqual(["compose"]);
    expect(VERB_CAPABILITIES["send"]).toStrictEqual(["send"]);
  });
});
