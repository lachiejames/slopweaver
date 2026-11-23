/*
 * `talk relay --offered-file`: the staged offer read back exactly, and every way a file can fail to be one refused
 * with `OFFERED_INVALID` before anything is claimed. Real files in a per-test temp directory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readOfferedFlag, readRelayOfferFile } from "../../../../../cli/commands/talk/relayOfferFile.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const OFFER = {
  belowFold: "the rest — “quoted” 🙂\n````",
  id: "offer-3",
  label: "reply to Ari",
  made: "3",
  text: "  Merged `#2209`, thanks <@U07ABC>  ",
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "relay-offer-file-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("readRelayOfferFile", () => {
  it("reads back exactly the offer the route staged", () => {
    const path = join(dir, "offer.json");
    writeFileSync(path, JSON.stringify(OFFER), { encoding: "utf8", mode: 0o600 });
    expect(unwrap(readRelayOfferFile({ path }))).toStrictEqual(OFFER);
  });

  it("refuses a file that is not whole UTF-8, rather than reading a replacement character into the owner's tray's text", () => {
    const path = join(dir, "offer.json");
    const json = Buffer.from(JSON.stringify({ ...OFFER, text: "Merged X" }), "utf8");
    json[json.indexOf("X")] = 0xff;
    writeFileSync(path, json);
    const failure = unwrapErr(readRelayOfferFile({ path }));
    expect(failure.code).toBe("OFFERED_INVALID");
    expect(failure.message).toContain("is not one UTF-8 JSON value");
  });

  it("refuses a file that is not JSON, a missing file, a directory and one past the bound", () => {
    const notJson = join(dir, "not.json");
    writeFileSync(notJson, "Merged, thanks");
    const directory = join(dir, "a-dir");
    mkdirSync(directory);
    const huge = join(dir, "huge.json");
    writeFileSync(huge, JSON.stringify({ ...OFFER, text: "x".repeat(60_000) }));
    const failures = [notJson, join(dir, "absent.json"), directory, huge].map((path) =>
      unwrapErr(readRelayOfferFile({ path })),
    );
    expect(failures.map((failure) => failure.code)).toEqual([
      "OFFERED_INVALID",
      "OFFERED_INVALID",
      "OFFERED_INVALID",
      "OFFERED_INVALID",
    ]);
    expect(failures[0]!.message).toContain("is not one UTF-8 JSON value");
    expect(failures[1]!.message).toContain("could not be read");
    expect(failures[2]!.message).toContain("is not a regular file");
    expect(failures[3]!.message).toContain("one offer is at most 50656");
  });

  it("refuses a well-formed file holding something that is not one offer", () => {
    const path = join(dir, "offer.json");
    writeFileSync(path, JSON.stringify({ ...OFFER, id: "offer-4" }));
    expect(unwrapErr(readRelayOfferFile({ path })).message).toBe(
      "the copy-tray offer this relay carries names id offer-4, but the page's id for made 3 is offer-3",
    );
  });
});

describe("readOfferedFlag", () => {
  it("carries no offer when the relay was given no --offered-file", () => {
    expect(unwrap(readOfferedFlag({ offeredFile: undefined }))).toBe(undefined);
  });

  it("reads the staged file when the flag names one, refusals included", () => {
    const path = join(dir, "offer.json");
    writeFileSync(path, JSON.stringify(OFFER), { encoding: "utf8", mode: 0o600 });
    expect(unwrap(readOfferedFlag({ offeredFile: path }))).toStrictEqual(OFFER);
    expect(unwrapErr(readOfferedFlag({ offeredFile: join(dir, "absent.json") })).code).toBe("OFFERED_INVALID");
  });
});
