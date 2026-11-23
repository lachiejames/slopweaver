/**
 * Every `billing` lane or system name in this file is a synthetic one rather than the installation's own.
 */

import { describe, expect, it } from "vitest";

import { parseHandPostArgs } from "../../../cli/commands/hand/core.js";
import { type AdcSigninInput, adcSigninId, adcSigninLine, adcSigninUnblocks } from "../../../hand/adcSignin.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const input = (over: Partial<AdcSigninInput> = {}): AdcSigninInput => ({
  cites: [],
  context: "work",
  row: "review-17961",
  unblocks: adcSigninUnblocks({ row: "review-17961" }),
  ...over,
});

describe("adcSigninId", () => {
  it("names the row, or stands alone", () => {
    expect([adcSigninId({ row: "review-17961" }), adcSigninId({})]).toEqual(["adc-signin-review-17961", "adc-signin"]);
  });

  it("cuts a long row to the id limit without a dangling separator", () => {
    const id = adcSigninId({ row: `${"a".repeat(48)}-bcd` });
    expect(id).toBe(`adc-signin-${"a".repeat(48)}`);
  });
});

describe("adcSigninLine", () => {
  it("passes every pure posting rule and round-trips through hand post's own parser", () => {
    const built = unwrap(adcSigninLine({ input: input() }));
    const values = unwrap(parseHandPostArgs({ rest: built.argv.slice(3) })).values;
    expect(values).toEqual({
      blocks: true,
      context: "work",
      id: "adc-signin-review-17961",
      literal: "gcloud auth application-default login",
      row: "review-17961",
      unblocks: "board row review-17961, stopped until Google Cloud application credentials work",
      what: "Sign in to Google Cloud from a plain terminal of yours, so the paused work can read Google Cloud again",
      where: "a plain terminal, not a Claude session; pick your work Google account when the browser opens",
      witness: "slopweaver hand done adc-signin-review-17961 --did signed-in",
    });
  });

  it("prints one pasteable line beginning with the verb", () => {
    expect(unwrap(adcSigninLine({ input: input() })).line).toContain(
      "slopweaver hand post --id adc-signin-review-17961 --what 'Sign in to Google Cloud from a plain terminal of yours, so the paused work can read Google Cloud again'",
    );
  });

  it("is standalone with no row, and blocks work", () => {
    const built = unwrap(adcSigninLine({ input: { cites: [], context: "work", unblocks: "the local billing lane" } }));
    expect(built.argv.slice(-2)).toEqual(["--standalone", "--blocks"]);
  });

  it("names the stopped seat, and hand post reads it back as the step's poster", () => {
    const built = unwrap(adcSigninLine({ input: input({ bySession: "workspace:77" }) }));
    const values = unwrap(parseHandPostArgs({ rest: built.argv.slice(3) })).values;
    expect([built.argv.slice(-2), values["by-session"]]).toEqual([["--by-session", "workspace:77"], "workspace:77"]);
  });

  it("points the owner's sign-in at the seat's own gcloud config directory", () => {
    const built = unwrap(adcSigninLine({ input: input({ cloudsdkConfig: "/tmp/gc" }) }));
    expect(built.argv[built.argv.indexOf("--literal") + 1]).toBe(
      "CLOUDSDK_CONFIG=/tmp/gc gcloud auth application-default login",
    );
  });

  it("quotes only the directory, so a space in it still leaves an assignment the shell reads", () => {
    const built = unwrap(adcSigninLine({ input: input({ cloudsdkConfig: "/Users/x/My Config" }) }));
    expect(built.argv[built.argv.indexOf("--literal") + 1]).toBe(
      "CLOUDSDK_CONFIG='/Users/x/My Config' gcloud auth application-default login",
    );
  });

  it("refuses a pull request number with no address, and takes one with --cites", () => {
    const refused = unwrapErr(adcSigninLine({ input: input({ unblocks: "the local lane for #17961" }) }));
    const cited = adcSigninLine({
      input: input({
        cites: ["https://github.com/acme/acme-admin/pull/17961"],
        unblocks: "the local lane for #17961",
      }),
    });
    expect([refused.code, cited.isOk()]).toEqual(["INVALID_FIELD", true]);
  });

  it("refuses an unblocks naming a proof, which is the fleet's to take", () => {
    expect(unwrapErr(adcSigninLine({ input: input({ unblocks: "the gold proof for the review" }) })).code).toBe(
      "PROOF_WITNESS_IS_OURS",
    );
  });
});
