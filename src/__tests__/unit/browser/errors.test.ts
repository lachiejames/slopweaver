/**
 * The real-Chrome lane's error union, and the one property that makes it a union rather than a string list:
 * each member has a DIFFERENT correction, and the caller prints it.
 *
 * The file's own reasoning names the failure it exists to prevent — collapsed into one string, the commonest
 * of these ("you are signed out of GitHub in Chrome") reads as "the cookie jar is broken", which sends the
 * reader to the wrong place entirely. So the tests below are about the message a human acts on, not only the
 * code a branch reads.
 */
import { describe, expect, it } from "vitest";

import { type RealChromeError, RealChromeErrors, STORED_PROFILE_SOURCE } from "../../../browser/errors.js";

/** One of every variant, built through the factory exactly as the real code builds them. */
const everyError: readonly RealChromeError[] = [
  RealChromeErrors.chromeNotFound({ detail: "no registry entry" }),
  RealChromeErrors.jarUnreadable({ detail: "no cookie database at /x" }),
  RealChromeErrors.keyUnavailable({ detail: "the user cancelled" }),
  RealChromeErrors.keyReadTimedOut({ timeoutMs: 120_000 }),
  RealChromeErrors.keyWrong(),
  RealChromeErrors.localStateUnreadable({ detail: "unexpected token", path: "/x/Local State" }),
  RealChromeErrors.originNotSignedIn({ origin: "https://github.com" }),
  RealChromeErrors.pinUnwritable({ detail: "read-only file system" }),
  RealChromeErrors.profileUnknown({ directory: "Profile 7", known: ["Default", "Profile 1"] }),
  RealChromeErrors.profileRegisterMalformed({ detail: "it is not a JSON object", source: STORED_PROFILE_SOURCE }),
  RealChromeErrors.profileRevisionConflict({ expectedRevision: 2 }),
  RealChromeErrors.profileStoreUnavailable({ doing: "be opened", reason: "connect ECONNREFUSED" }),
  RealChromeErrors.profileUnset(),
  RealChromeErrors.unsupportedPlatform({ platform: "win32" }),
  RealChromeErrors.userDataMissing({ path: "/x/Chrome" }),
];

describe("RealChromeErrors covers the union it belongs to", () => {
  it("has one factory per variant, so no member can be constructed only by hand", () => {
    expect(Object.keys(RealChromeErrors)).toHaveLength(everyError.length);
  });

  it("gives every variant its own code", () => {
    expect(new Set(everyError.map((error) => error.code)).size).toBe(everyError.length);
  });

  it("gives every variant a message a caller can display", () => {
    expect(everyError.filter((error) => error.message.length === 0)).toEqual([]);
  });

  it("writes every code in SCREAMING_SNAKE_CASE, which is what a caller branches on", () => {
    expect(everyError.filter((error) => !/^[A-Z][A-Z_]*$/.test(error.code))).toEqual([]);
  });
});

describe("each message carries the correction that fixes THAT failure and no other", () => {
  it("sends an unrecorded profile to the verb that records one", () => {
    const error = RealChromeErrors.profileUnset();
    expect(error.message).toContain("slopweaver browser profile --list");
  });

  it("says the recorded profile is kept in the store, never in a file the owner might go and edit", () => {
    expect(RealChromeErrors.profileUnset().message).toContain("recorded in this install's store");
  });

  // An outage is UNKNOWN, not unset: reading it as "nothing recorded" is the guess this lane exists to refuse.
  it("says an unreachable store leaves the work profile unknown, launched nothing, and carries the store's reason", () => {
    const error = RealChromeErrors.profileStoreUnavailable({ doing: "be opened", reason: "connect ECONNREFUSED" });
    expect(error.message).toContain("UNKNOWN — nothing was launched");
    expect(error.message).toContain("could not be opened");
    expect(error.message).toContain("The store said: connect ECONNREFUSED");
  });

  it("says a conflicting record wrote nothing, naming the revision it read", () => {
    const error = RealChromeErrors.profileRevisionConflict({ expectedRevision: 2 });
    expect(error.message).toContain("read at revision 2");
    expect(error.message).toContain("nothing was written");
    expect(error.expectedRevision).toBe(2);
  });

  // The whole reason this variant carries a LIST: "Profile 7 is unknown" is unactionable on its own.
  it("tells an unknown profile which directories Chrome actually lists", () => {
    const error = RealChromeErrors.profileUnknown({ directory: "Profile 7", known: ["Default", "Profile 1"] });
    expect(error.message).toContain("Default, Profile 1");
  });

  it("names the directory that was not found, beside the ones that were", () => {
    const error = RealChromeErrors.profileUnknown({ directory: "Profile 7", known: ["Default"] });
    expect(error.directory).toBe("Profile 7");
  });

  it("carries the known list as a field too, so a caller can offer them rather than re-parse the message", () => {
    const error = RealChromeErrors.profileUnknown({ directory: "Profile 7", known: ["Default", "Profile 1"] });
    expect(error.known).toEqual(["Default", "Profile 1"]);
  });

  it("tells a keyring refusal that macOS asks once and remembers the answer", () => {
    expect(RealChromeErrors.keyUnavailable({ detail: "cancelled" }).message).toContain("Always Allow");
  });

  // A dialog behind another window is the likeliest cause, and the reader has to know where to look.
  it("tells a timed-out keyring read to answer the dialog, and says how long it waited", () => {
    const error = RealChromeErrors.keyReadTimedOut({ timeoutMs: 120_000 });
    expect(error.message).toContain("answer it (Always Allow)");
    expect(error.message).toContain("within 120s");
  });

  it("says a wrong key read NOTHING, so a reader does not go looking for a partial result", () => {
    expect(RealChromeErrors.keyWrong().message).toContain("Nothing was read");
  });

  // The commonest real failure by far, and the one a collapsed string would have mis-sent.
  it("tells a signed-out origin to sign in to it in the owner's OWN browser", () => {
    const error = RealChromeErrors.originNotSignedIn({ origin: "https://github.com" });
    expect(error.message).toContain("Sign in to it in your own browser");
  });

  it("names the origin the owner is signed out of, because that is the whole actionable content", () => {
    const error = RealChromeErrors.originNotSignedIn({ origin: "https://github.com" });
    expect(error.message).toContain("https://github.com");
  });

  it("says there is no second profile to sign in to, which is the ruling this lane implements", () => {
    const error = RealChromeErrors.originNotSignedIn({ origin: "https://github.com" });
    expect(error.message).toContain("there is no second profile");
  });

  it("names the platform it cannot read a jar on, rather than reporting a broken jar", () => {
    expect(RealChromeErrors.unsupportedPlatform({ platform: "win32" }).message).toContain("win32");
  });

  it("says an unsupported platform launched nothing either, not only that it read nothing", () => {
    const error = RealChromeErrors.unsupportedPlatform({ platform: "win32" });
    expect(error.message).toContain("nothing was launched");
  });

  it("names the missing user-data directory, which is the path a reader checks first", () => {
    expect(RealChromeErrors.userDataMissing({ path: "/x/Chrome" }).message).toContain("/x/Chrome");
  });

  it("names both the index it could not read and why", () => {
    const error = RealChromeErrors.localStateUnreadable({ detail: "unexpected token", path: "/x/Local State" });
    expect(error.message).toContain("/x/Local State");
    expect(error.message).toContain("unexpected token");
  });

  it("carries the underlying detail as a field as well as in the message", () => {
    const error = RealChromeErrors.localStateUnreadable({ detail: "unexpected token", path: "/x/Local State" });
    expect(error.detail).toBe("unexpected token");
  });

  it("says a missing Chrome means there is no browser to pin a profile ON", () => {
    expect(RealChromeErrors.chromeNotFound({ detail: "no registry entry" }).message).toContain(
      "no browser to pin a profile on",
    );
  });

  // A pin that silently failed would send a browser leg to whichever profile the owner last used — which is the
  // one outcome `docs/browser-route/brief-profile-and-walks.md` forbids outright.
  it("says an unwritable pin launched nothing, rather than falling back to the last-used profile", () => {
    expect(RealChromeErrors.pinUnwritable({ detail: "read-only" }).message).toContain("Nothing was launched");
  });

  it("carries the jar's own failure detail through, because 'unreadable' alone is not reproducible", () => {
    const error = RealChromeErrors.jarUnreadable({ detail: "no cookie database at /x/Cookies" });
    expect(error.message).toContain("/x/Cookies");
  });
});

describe("the union is exhaustive, so a new variant cannot be silently unhandled", () => {
  /** A total mapper: adding a variant without a case here fails to COMPILE, which is the point. */
  function correctionKind({ error }: { error: RealChromeError }): string {
    switch (error.code) {
      case "CHROME_NOT_FOUND":
        return "install";
      case "PIN_UNWRITABLE":
        return "disk";
      case "PROFILE_UNSET":
        return "record";
      case "PROFILE_REGISTER_MALFORMED":
        return "repair";
      case "PROFILE_STORE_UNAVAILABLE":
        return "store";
      case "PROFILE_REVISION_CONFLICT":
        return "re-read";
      case "PROFILE_UNKNOWN":
        return "record";
      case "USER_DATA_MISSING":
        return "install";
      case "LOCAL_STATE_UNREADABLE":
        return "disk";
      case "KEY_UNAVAILABLE":
        return "keyring";
      case "KEY_READ_TIMED_OUT":
        return "keyring";
      case "KEY_WRONG":
        return "keyring";
      case "JAR_UNREADABLE":
        return "disk";
      case "ORIGIN_NOT_SIGNED_IN":
        return "sign-in";
      case "UNSUPPORTED_PLATFORM":
        return "unfixable";
      default: {
        const unreachable: never = error;
        return unreachable;
      }
    }
  }

  it("maps every variant to a correction, with no variant falling through", () => {
    expect(everyError.map((error) => correctionKind({ error })).filter((kind) => kind.length === 0)).toEqual([]);
  });

  // The four corrections the file's own reasoning names, the two the pin lane added, and the store's three.
  it("does not collapse to one correction, which is the whole reason this is a union", () => {
    expect(new Set(everyError.map((error) => correctionKind({ error }))).size).toBe(9);
  });

  it("calls exactly one of them unfixable, and it is the platform", () => {
    const unfixable = everyError.filter((error) => correctionKind({ error }) === "unfixable");
    expect(unfixable.map((error) => error.code)).toEqual(["UNSUPPORTED_PLATFORM"]);
  });
});
