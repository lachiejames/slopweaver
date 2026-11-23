import { describe, expect, it } from "vitest";

import { parseChromeProfiles, resolveRecordedProfile } from "../../../browser/profileIndex.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const PATH = "/tmp/Local State";

const indexJson = JSON.stringify({
  profile: {
    info_cache: {
      "Profile 1": { name: "Personal", user_name: "someone@example.invalid" },
      Default: { name: "Work", user_name: "worker@example.invalid" },
    },
  },
});

describe("parseChromeProfiles", () => {
  it("reads every profile, sorted by directory so a listing is stable", () => {
    expect(unwrap(parseChromeProfiles({ json: indexJson, path: PATH }))).toEqual([
      { accountEmail: "worker@example.invalid", directory: "Default", name: "Work" },
      { accountEmail: "someone@example.invalid", directory: "Profile 1", name: "Personal" },
    ]);
  });

  it("falls back to the directory name when Chrome recorded no display name", () => {
    const json = JSON.stringify({ profile: { info_cache: { Default: {} } } });
    expect(unwrap(parseChromeProfiles({ json, path: PATH }))[0]).toEqual({
      accountEmail: undefined,
      directory: "Default",
      name: "Default",
    });
  });

  it("names the file when the index will not parse", () => {
    const result = parseChromeProfiles({ json: "not json", path: PATH });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("LOCAL_STATE_UNREADABLE");
    expect(unwrapErr(result).message).toContain(PATH);
  });

  it("refuses a document that parses but carries no profile index", () => {
    const result = parseChromeProfiles({ json: JSON.stringify({ profile: {} }), path: PATH });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("LOCAL_STATE_UNREADABLE");
  });

  it("reads an index with no profiles as an empty list rather than as a failure", () => {
    const json = JSON.stringify({ profile: { info_cache: {} } });
    expect(unwrap(parseChromeProfiles({ json, path: PATH }))).toEqual([]);
  });
});

describe("resolveRecordedProfile", () => {
  const profiles = unwrap(parseChromeProfiles({ json: indexJson, path: PATH }));

  it("resolves a directory Chrome lists", () => {
    expect(unwrap(resolveRecordedProfile({ directory: "Default", profiles })).name).toBe("Work");
  });

  it("REFUSES a directory Chrome no longer lists, rather than reading an empty jar", () => {
    // The failure this prevents: a profile Chrome re-created under another name reads as "you are signed
    // out of everything", about a browser the owner is plainly signed in to.
    const result = resolveRecordedProfile({ directory: "Profile 9", profiles });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("PROFILE_UNKNOWN");
    expect(unwrapErr(result).message).toContain("Default, Profile 1");
  });
});
