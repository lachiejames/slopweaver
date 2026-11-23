/**
 * Reading a store's credential document through a recording item reader in place of the macOS keychain: the
 * default store is asked for under its bare service name and a store directory under its derived suffix, each
 * with the five-second timeout; the item's text is trimmed and parsed whole; and a locked keychain, a missing
 * item, any other refusal and text that is not JSON all read as no document at all. No fixture here is a real
 * credential.
 */
import { describe, expect, it } from "vitest";

import { type KeychainItemReader, readCredentialDocument } from "../../../claude/keychain.js";

/** One ask the reader received. */
interface ReadAsk {
  readonly service: string;
  readonly timeoutMs: number;
}

/** A reader answering one fixed text, recording each ask. */
function answering({ asks, text }: { asks: ReadAsk[]; text: string }): KeychainItemReader {
  return ({ service, timeoutMs }) => {
    asks.push({ service, timeoutMs });
    return text;
  };
}

/** A reader throwing one fixed value, recording each ask. */
function throwing({ asks, thrown }: { asks: ReadAsk[]; thrown: unknown }): KeychainItemReader {
  return ({ service, timeoutMs }) => {
    asks.push({ service, timeoutMs });
    throw thrown;
  };
}

/** A refusal shaped like the one `execFileSync` throws when `security` exits with a status. */
function exitedWith({ status }: { status: number }): Error {
  return Object.assign(new Error(`security exited ${String(status)}`), { status });
}

describe("readCredentialDocument", () => {
  it("asks the default store's bare service name with the five-second timeout and decodes the item whole", () => {
    const asks: ReadAsk[] = [];

    const document = readCredentialDocument({
      readItem: answering({ asks, text: '{"claudeAiOauth":{"subscriptionType":"max"},"mcpOAuth":{}}' }),
    });

    expect(document).toEqual({ claudeAiOauth: { subscriptionType: "max" }, mcpOAuth: {} });
    expect(asks).toEqual([{ service: "Claude Code-credentials", timeoutMs: 5000 }]);
  });

  it("asks a store directory's item under its derived suffixed service name", () => {
    const asks: ReadAsk[] = [];

    readCredentialDocument({ readItem: answering({ asks, text: "{}" }), storeDir: "/stores/plan-b" });

    // The first eight hex of `sha256("/stores/plan-b")`, checked with `shasum -a 256` over a file holding the path.
    expect(asks).toEqual([{ service: "Claude Code-credentials-8c613521", timeoutMs: 5000 }]);
  });

  it("trims the whitespace `security` prints around the item before decoding it", () => {
    expect(readCredentialDocument({ readItem: answering({ asks: [], text: '\n  {"a":1}\n' }) })).toEqual({ a: 1 });
  });

  it("reads a locked keychain (exit 36) as no document, after one ask", () => {
    const asks: ReadAsk[] = [];

    expect(
      readCredentialDocument({ readItem: throwing({ asks, thrown: exitedWith({ status: 36 }) }) }),
    ).toBeUndefined();
    expect(asks).toEqual([{ service: "Claude Code-credentials", timeoutMs: 5000 }]);
  });

  it("reads a missing item (exit 44) as no document", () => {
    expect(
      readCredentialDocument({ readItem: throwing({ asks: [], thrown: exitedWith({ status: 44 }) }) }),
    ).toBeUndefined();
  });

  it("reads any other refusal, with or without a status, as no document rather than throwing", () => {
    expect(
      readCredentialDocument({ readItem: throwing({ asks: [], thrown: exitedWith({ status: 1 }) }) }),
    ).toBeUndefined();
    expect(
      readCredentialDocument({ readItem: throwing({ asks: [], thrown: new Error("ETIMEDOUT") }) }),
    ).toBeUndefined();
  });

  it("reads an item whose text is not JSON as no document", () => {
    expect(readCredentialDocument({ readItem: answering({ asks: [], text: "not json" }) })).toBeUndefined();
  });
});
