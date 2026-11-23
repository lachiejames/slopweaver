import { describe, expect, it } from "vitest";

import { BrowserVerbErrors } from "../../../../../cli/commands/browser/errors.js";
import {
  BROWSER_FLAG_NAMES,
  parseBrowserArgs,
  recordedProfileLine,
  renderProfileList,
} from "../../../../../cli/commands/browser/profileCore.js";
import { BROWSER_USAGE } from "../../../../../cli/commands/browser/usage.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseBrowserArgs", () => {
  it("has at least one entry in BROWSER_FLAG_NAMES, so the guards below are not vacuously green", () => {
    expect(BROWSER_FLAG_NAMES.length).toBeGreaterThan(0);
  });

  it("parses `profile` with nothing else", () => {
    const options = unwrap(parseBrowserArgs({ rest: ["profile"] }));
    expect(options.subverb).toBe("profile");
    expect(options.list).toBe(false);
    expect(options.set).toBe(undefined);
  });

  it("reads --list and --set", () => {
    expect(unwrap(parseBrowserArgs({ rest: ["profile", "--list"] })).list).toBe(true);
    expect(unwrap(parseBrowserArgs({ rest: ["profile", "--set", "Default"] })).set).toBe("Default");
  });

  it("reads --origin, --json and --home", () => {
    const options = unwrap(
      parseBrowserArgs({ rest: ["cookies", "--origin", "https://github.com", "--json", "--home", "/tmp"] }),
    );
    expect(options.origin).toBe("https://github.com");
    expect(options.json).toBe(true);
    expect(options.home).toBe("/tmp");
  });

  it("refuses `cookies` with no origin, because there is nothing to ask about", () => {
    expect(unwrapErr(parseBrowserArgs({ rest: ["cookies"] }))).toEqual(BrowserVerbErrors.originMissing());
  });

  it("accepts pin, which needs no flags of its own", () => {
    expect(unwrap(parseBrowserArgs({ rest: ["pin"] })).subverb).toBe("pin");
  });

  it("refuses a sub-verb it does not have, and says which it does", () => {
    expect(unwrapErr(parseBrowserArgs({ rest: ["launch"] })).message).toContain("profile, cookies, pin, shot");
  });

  it("requires a sub-verb rather than defaulting to one", () => {
    const error = unwrapErr(parseBrowserArgs({ rest: [] }));
    expect(error.code).toBe("SUBVERB_MISSING");
    expect(error.message).toContain("got nothing");
  });

  it("treats an empty --home as absent rather than as the root directory", () => {
    expect(unwrap(parseBrowserArgs({ rest: ["profile", "--home", ""] })).home).toBe(undefined);
  });

  it("names every flag it accepts in its own usage line", () => {
    for (const flag of BROWSER_FLAG_NAMES) {
      expect(BROWSER_USAGE).toContain(flag);
    }
  });
});

describe("renderProfileList", () => {
  const profiles = [
    { accountEmail: "worker@example.invalid", directory: "Default", name: "Work" },
    { accountEmail: undefined, directory: "Profile 1", name: "Personal" },
  ];

  it("prints the account, which is the only thing that tells two profiles apart for a reader", () => {
    expect(renderProfileList({ profiles, recorded: undefined })[0]).toBe("  Default  Work  worker@example.invalid");
  });

  it("says so plainly when a profile has no account", () => {
    expect(renderProfileList({ profiles, recorded: undefined })[1]).toBe("  Profile 1  Personal  (no account)");
  });

  it("marks the recorded one, so a reader never has to remember which they picked", () => {
    expect(renderProfileList({ profiles, recorded: "Default" })[0]).toContain("<- recorded");
    expect(renderProfileList({ profiles, recorded: "Default" })[1]).not.toContain("<- recorded");
  });

  it("renders an empty index as no lines rather than as a placeholder", () => {
    expect(renderProfileList({ profiles: [], recorded: undefined })).toEqual([]);
  });

  it("marks a recorded profile with no account after the no-account word", () => {
    expect(renderProfileList({ profiles, recorded: "Profile 1" })[1]).toBe(
      "  Profile 1  Personal  (no account) <- recorded",
    );
  });
});

describe("recordedProfileLine", () => {
  const signedIn = { accountEmail: "worker@example.invalid", directory: "Default", name: "Work" };
  const signedOut = { accountEmail: undefined, directory: "Profile 1", name: "Personal" };

  it("names the account the recorded profile is signed in as", () => {
    expect(recordedProfileLine({ json: false, profile: signedIn, revision: 4 })).toBe(
      "recorded Default (worker@example.invalid) in the store (revision 4)",
    );
  });

  it("says no account in prose when the profile has none", () => {
    expect(recordedProfileLine({ json: false, profile: signedOut, revision: 1 })).toBe(
      "recorded Profile 1 (no account) in the store (revision 1)",
    );
  });

  it("carries the account and store revision in JSON, and null when the profile has none", () => {
    expect(JSON.parse(recordedProfileLine({ json: true, profile: signedIn, revision: 4 }))).toEqual({
      account: "worker@example.invalid",
      profileDirectory: "Default",
      revision: 4,
    });
    expect(recordedProfileLine({ json: true, profile: signedOut, revision: 1 })).toBe(
      JSON.stringify({ account: null, profileDirectory: "Profile 1", revision: 1 }, null, 2),
    );
  });
});
