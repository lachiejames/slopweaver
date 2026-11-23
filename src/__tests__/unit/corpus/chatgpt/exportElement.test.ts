/**
 * `readExportElement`: one conversations-file element as a value, refusing a key spelled twice by its path and the
 * ids it names, so a reader never sees what `JSON.parse` silently dropped.
 */
import { describe, expect, it } from "vitest";

import { ChatgptElementErrors, elementIds, readExportElement } from "../../../../corpus/chatgpt/exportElement.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const LABEL = "chatgpt conversations.json element 0";

describe("readExportElement", () => {
  it("reads an element whose objects each spell their keys once", () => {
    const read = readExportElement({ label: LABEL, text: '{"id":"c","mapping":{"a":{},"b":{}}}' });
    expect(unwrap(read)).toEqual({ id: "c", mapping: { a: {}, b: {} } });
  });

  it("refuses a key spelled twice by its path, naming the conversation's ids", () => {
    const text = '{"id":"c","conversation_id":"c","mapping":{"n":{"message":"lost"},"n":{"message":null}}}';
    expect(unwrapErr(readExportElement({ label: LABEL, text }))).toEqual(
      ChatgptElementErrors.duplicateKey({ ids: ["c", "c"], path: ["mapping", "n"] }),
    );
  });

  it("names no conversation when the key spelled twice is the id itself", () => {
    const text = '{"id":"c","id":"d","mapping":{}}';
    expect(unwrapErr(readExportElement({ label: LABEL, text }))).toEqual(
      ChatgptElementErrors.duplicateKey({ ids: [], path: ["id"] }),
    );
  });

  it("refuses text that is not JSON, naming no conversation", () => {
    const refused = unwrapErr(readExportElement({ label: LABEL, text: '{"id":' }));
    expect([refused.code, refused.ids]).toEqual(["ELEMENT_NOT_JSON", []]);
    expect(refused.message).toContain("is not JSON it can read");
  });
});

describe("elementIds", () => {
  it("names `id` then `conversation_id`, only where each is a string", () => {
    expect(elementIds({ value: { conversation_id: "b", id: "a" } })).toEqual(["a", "b"]);
    expect(elementIds({ value: { conversation_id: 7, id: null } })).toEqual([]);
    expect(elementIds({ value: ["a"] })).toEqual([]);
    expect(elementIds({ value: "a" })).toEqual([]);
  });
});
