/**
 * The bronze-access failures: each factory's exact sentence, and that `StoreErrors` hands out the same
 * factories, so a caller reaching `StoreErrors.bronzeProtected` builds the value this module declares.
 */

import { describe, expect, it } from "vitest";

import { StoreBronzeAccessErrors } from "../../../store/bronzeAccessErrors.js";
import { StoreErrors } from "../../../store/errors.js";

describe("StoreBronzeAccessErrors", () => {
  it("names the path, the entry and the owner's reason when bronze is protected", () => {
    expect(
      StoreBronzeAccessErrors.bronzeProtected({
        path: "/h/corpus/bronze/chatgpt",
        protectedPath: "/h/corpus/bronze/chatgpt",
        why: "private",
      }),
    ).toEqual({
      code: "BRONZE_PROTECTED",
      message:
        "bronze at /h/corpus/bronze/chatgpt reaches /h/corpus/bronze/chatgpt, which the owner's protect list marks " +
        "no-access (private), so none of it is read. A session never takes a path off the protect list; " +
        "`slopweaver protect list` shows why.",
      path: "/h/corpus/bronze/chatgpt",
      protectedPath: "/h/corpus/bronze/chatgpt",
      why: "private",
    });
  });

  it("carries an Error cause's message, and a non-Error cause as text, when bronze is unreadable", () => {
    const cause = new Error("EACCES: permission denied");
    expect(StoreBronzeAccessErrors.bronzeUnreadable({ cause, path: "/h/a.jsonl" })).toEqual({
      cause,
      code: "BRONZE_UNREADABLE",
      message: "bronze at /h/a.jsonl could not be read: EACCES: permission denied",
      path: "/h/a.jsonl",
    });
    expect(StoreBronzeAccessErrors.bronzeUnreadable({ cause: 7, path: "/h/a.jsonl" }).message).toBe(
      "bronze at /h/a.jsonl could not be read: 7",
    );
  });

  it("says no bronze is read when the protect list is unknown", () => {
    expect(StoreBronzeAccessErrors.protectionUnknown({ reason: "malformed JSON" })).toEqual({
      code: "PROTECTION_UNKNOWN",
      message: "the owner's protect list could not be read, so no bronze is read: malformed JSON",
    });
  });

  it("is what StoreErrors hands out", () => {
    expect(StoreErrors.bronzeProtected).toBe(StoreBronzeAccessErrors.bronzeProtected);
    expect(StoreErrors.bronzeUnreadable).toBe(StoreBronzeAccessErrors.bronzeUnreadable);
    expect(StoreErrors.protectionUnknown).toBe(StoreBronzeAccessErrors.protectionUnknown);
  });
});
