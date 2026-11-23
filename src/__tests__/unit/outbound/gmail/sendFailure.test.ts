/**
 * `refusedBeforeGmailWire`: only an instance of one of the two pre-wire refusal classes, found along a bounded and
 * cycle-safe `cause` chain, proves a Gmail write sent nothing. A lookalike carrying the same words or name, a chain
 * deeper than the bound, and a cycle are each NOT proof.
 */
import { describe, expect, it } from "vitest";

import { GmailErrors } from "../../../../live/gmail/errors.js";
import { refusedBeforeGmailWire } from "../../../../outbound/gmail/sendFailure.js";
import { GmailWriteRefusedError } from "../../../../outbound/gmail/writePrivacy.js";
import { InvalidDatadogHostRefusedError } from "../../../../outbound/invalidDatadogHost.js";

/** `error` wrapped in `depth` plain `{ cause }` links. */
function wrapped({ error, depth }: { error: unknown; depth: number }): unknown {
  let link: unknown = error;
  for (let level = 0; level < depth; level += 1) {
    link = { cause: link, message: `link ${String(level)}` };
  }
  return link;
}

describe("refusedBeforeGmailWire", () => {
  it("recognises either refusal class at the top", () => {
    expect(refusedBeforeGmailWire({ error: new GmailWriteRefusedError("refused") })).toBe(true);
    expect(refusedBeforeGmailWire({ error: new InvalidDatadogHostRefusedError("dead host") })).toBe(true);
  });

  it("finds a refusal four links down, the real GmailError → IngestError → GaxiosError → refusal chain", () => {
    const gaxios = Object.assign(new Error("refused"), { cause: new GmailWriteRefusedError("refused") });
    const ingest = { cause: gaxios, kind: "http", message: "refused", operation: "gmail.users.drafts.create" };
    const error = GmailErrors.apiFailed({ cause: ingest, message: "refused" });
    expect(refusedBeforeGmailWire({ error })).toBe(true);
  });

  it("stops at the bound of eight links", () => {
    expect(refusedBeforeGmailWire({ error: wrapped({ depth: 7, error: new GmailWriteRefusedError("r") }) })).toBe(true);
    expect(refusedBeforeGmailWire({ error: wrapped({ depth: 8, error: new GmailWriteRefusedError("r") }) })).toBe(
      false,
    );
  });

  it("does not count a lookalike: the same name, the same words, or a plain error", () => {
    const named = Object.assign(new Error("refused before sending"), { name: "GmailWriteRefusedError" });
    expect(refusedBeforeGmailWire({ error: named })).toBe(false);
    expect(refusedBeforeGmailWire({ error: { message: "refused before sending: the outbound privacy check" } })).toBe(
      false,
    );
    expect(refusedBeforeGmailWire({ error: GmailErrors.apiFailed({ message: "ECONNRESET" }) })).toBe(false);
    expect(refusedBeforeGmailWire({ error: undefined })).toBe(false);
  });

  it("ends on a cycle rather than looping", () => {
    const first: { cause?: unknown } = {};
    const second = { cause: first };
    first.cause = second;
    expect(refusedBeforeGmailWire({ error: first })).toBe(false);
  });
});
