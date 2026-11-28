/**
 * Unit: what `redactRecord` does to a record's `author` — an address or token is scrubbed, while a value that
 * is its source's own native-id shape passes byte for byte, because the identity roster joins on it.
 */
import { describe, expect, it } from "vitest";

import { redactRecord } from "../../../corpus/redactRecord.js";
import type { CorpusRecord, CorpusSource } from "../../../corpus/types.js";

/** One minimal record under `source`, authored by `author`. */
function authored({ source, author }: { source: CorpusSource; author: string }): CorpusRecord {
  return {
    author,
    container: "c",
    kind: "event",
    refs: [],
    source,
    sourceId: "id-1",
    text: "hi",
    tsIso: "2026-09-08T00:00:00Z",
    url: "u",
  };
}

/** The author `redactRecord` writes. */
function writtenAuthor({ source, author }: { source: CorpusSource; author: string }): string | undefined {
  return redactRecord({ record: authored({ author, source }) }).author;
}

// Assembled at runtime, as `redact.test.ts` does, so the hygiene scan never reads a credential literal.
const SK_SHAPED = ["sk", "-", "a".repeat(20)].join("");

describe("redactRecord's author pass", () => {
  it("scrubs an address a diary or recorded-call author carries", () => {
    expect(writtenAuthor({ author: "boss@example.test", source: "calendar" })).toBe("[email]");
    expect(writtenAuthor({ author: "Ada <ada@example.test>", source: "fathom" })).toBe("Ada <[email]>");
  });

  it("scrubs a quoted local part, and the forms only the author pass reaches: an address literal, one label", () => {
    expect(writtenAuthor({ author: '"boss"@example.test', source: "gmail" })).toBe("[email]");
    expect(writtenAuthor({ author: '"big boss"@example.test', source: "calendar" })).toBe("[email]");
    expect(writtenAuthor({ author: "boss@[192.0.2.1]", source: "fathom" })).toBe("[email]");
    expect(writtenAuthor({ author: "Ada <ada@localhost>", source: "fathom" })).toBe("Ada <[email]>");
  });

  it("keeps a name whose `@` stands between spaces, because that is not an address", () => {
    expect(writtenAuthor({ author: "Team @ Acme", source: "calendar" })).toBe("Team @ Acme");
  });

  it("scrubs a token shape in an author that is not a native id", () => {
    expect(writtenAuthor({ author: `key ${SK_SHAPED}`, source: "calendar" })).toBe("key [token]");
  });

  it("skips the long-digit pass, so a nine-digit run in an author survives", () => {
    expect(writtenAuthor({ author: "room-123456789", source: "calendar" })).toBe("room-123456789");
  });

  it("passes a GitHub login the token pass would match, because it is GitHub's native-id shape", () => {
    expect(writtenAuthor({ author: SK_SHAPED, source: "github" })).toBe(SK_SHAPED);
  });

  it("still scrubs an address under a source whose native id it is not", () => {
    expect(writtenAuthor({ author: "pat@example.test", source: "slack" })).toBe("[email]");
  });
});
