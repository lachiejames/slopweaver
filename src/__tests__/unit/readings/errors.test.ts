/**
 * `readingsErrorMessageWithoutStorePath`: the readings failures that carry a filesystem path, or the index's own text,
 * are worded without it, every other one keeps its own message, and the raw factory messages a human repairing the
 * ledger reads keep the path.
 */
import { describe, expect, it } from "vitest";

import { ReadingsErrors, readingsErrorMessageWithoutStorePath } from "../../../readings/errors.js";

const STORE_PATH = "/private/tmp/sw-example-home/readings/index.jsonl";
const LOCK_PATH = "/private/tmp/sw-example-home/locks/readings-ledger.lock";

describe("readingsErrorMessageWithoutStorePath", () => {
  it("words an unreadable ledger without the path its raw message names", () => {
    const raw = ReadingsErrors.storeUnreadable({ cause: "EACCES", path: STORE_PATH });
    expect(raw.path).toBe(STORE_PATH);
    expect(raw.message).toContain(STORE_PATH);
    expect(readingsErrorMessageWithoutStorePath({ error: raw })).toBe(
      "could not read the readings ledger — refusing rather than reporting it empty",
    );
  });

  it("words a held lock without the lock's own reason, which can name its file", () => {
    const raw = ReadingsErrors.ledgerBusy({ why: `the lock at ${LOCK_PATH} is held` });
    expect(raw.message).toContain(LOCK_PATH);
    expect(readingsErrorMessageWithoutStorePath({ error: raw })).toBe(
      "another session is writing the readings ledger right now — nothing was written; try again",
    );
  });

  it("names a corrupt row by its line alone, since its reason quotes what the line holds", () => {
    const raw = ReadingsErrors.corruptRow({ lineNumber: 2, why: `the field \`${STORE_PATH}\` is written twice` });
    expect(raw.message).toContain(STORE_PATH);
    expect(readingsErrorMessageWithoutStorePath({ error: raw })).toBe("readings index line 2 is not a reading row");
  });

  it("keeps the message of every failure worded from this code's own values", () => {
    const invalid = ReadingsErrors.invalidField({ field: "fromIso", why: 'is not an instant: "soon"' });
    const none = ReadingsErrors.noReading({ producer: "claude spend" });
    expect([invalid, none].map((error) => readingsErrorMessageWithoutStorePath({ error }))).toStrictEqual([
      'fromIso is not an instant: "soon"',
      "the readings ledger holds no reading by `claude spend` yet — record one with `slopweaver reading record`",
    ]);
  });
});
