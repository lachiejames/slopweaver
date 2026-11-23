/**
 * Reading the owner's Nx Cloud session, with the recorded profile in an in-memory store and the cookie jar replaced by
 * a typed reader fake — no Chrome profile, keyring or SQLite database is touched. The jar is asked for the
 * recorded profile and origin on this platform; a jar carrying `_nxCloudSession` yields a header in jar order
 * and the cookie names sorted, one without it, a failed jar read and an unrecorded profile are each
 * SESSION_ABSENT saying which.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NxCloudAtlasErrors } from "../../../../atlas/nxCloud/errors.js";
import { readNxCloudSession } from "../../../../atlas/nxCloud/session.js";
import type { readOriginCookies } from "../../../../browser/cookieJar.js";
import type { JarCookie } from "../../../../browser/cookieScope.js";
import { RealChromeErrors } from "../../../../browser/errors.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { memoryRecordedProfilePort } from "../../../recordedProfileFixture.js";

const ORIGIN = "https://cloud.nx.app";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "nx-session-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A port holding `Profile 3` as the browser legs' recorded profile. */
function recordedProfile(): ReturnType<typeof memoryRecordedProfilePort> {
  return memoryRecordedProfilePort({ directory: "Profile 3" });
}

/** One jar cookie for cloud.nx.app carrying a name and value. */
function cookie({ name, value }: { name: string; value: string }): JarCookie {
  return { domain: "cloud.nx.app", expires: -1, httpOnly: true, name, path: "/", secure: true, value };
}

describe("readNxCloudSession", () => {
  it("asks the jar for the recorded profile and origin, and keeps jar order in the header while sorting the names", async () => {
    const calls: Parameters<typeof readOriginCookies>[0][] = [];
    const readCookies: typeof readOriginCookies = async (input) => {
      calls.push(input);
      return ok([
        cookie({ name: "zeta", value: "z1" }),
        cookie({ name: "_nxCloudSession", value: "s1" }),
        cookie({ name: "alpha", value: "a1" }),
      ]);
    };

    const session = unwrap(
      await readNxCloudSession({ home, origin: ORIGIN, profiles: recordedProfile(), readCookies }),
    );

    expect(calls).toEqual([{ directory: "Profile 3", origin: ORIGIN, platform: process.platform }]);
    expect(session).toEqual({
      cookieNames: ["_nxCloudSession", "alpha", "zeta"],
      header: "zeta=z1; _nxCloudSession=s1; alpha=a1",
      profileDirectory: "Profile 3",
    });
  });

  it("admits a jar carrying _nxCloudSession and refuses one without it as SESSION_ABSENT naming the count", async () => {
    const withSession: typeof readOriginCookies = async () => ok([cookie({ name: "_nxCloudSession", value: "s1" })]);
    const withoutSession: typeof readOriginCookies = async () =>
      ok([cookie({ name: "alpha", value: "a1" }), cookie({ name: "zeta", value: "z1" })]);

    const admitted = await readNxCloudSession({
      home,
      origin: ORIGIN,
      profiles: recordedProfile(),
      readCookies: withSession,
    });
    const refused = unwrapErr(
      await readNxCloudSession({ home, origin: ORIGIN, profiles: recordedProfile(), readCookies: withoutSession }),
    );

    expect(unwrap(admitted).header).toBe("_nxCloudSession=s1");
    expect(refused.code).toBe("SESSION_ABSENT");
    expect(refused).toEqual(
      NxCloudAtlasErrors.sessionAbsent({
        detail: "profile Profile 3 holds 2 cookie(s) for https://cloud.nx.app and none of them is `_nxCloudSession`",
      }),
    );
  });

  it("is SESSION_ABSENT carrying the jar's own message when the jar cannot be read", async () => {
    const readCookies: typeof readOriginCookies = async () =>
      err(RealChromeErrors.jarUnreadable({ detail: "database is locked" }));

    const error = unwrapErr(
      await readNxCloudSession({ home, origin: ORIGIN, profiles: recordedProfile(), readCookies }),
    );

    expect(error.code).toBe("SESSION_ABSENT");
    expect(error).toEqual(
      NxCloudAtlasErrors.sessionAbsent({
        detail: "the profile's cookie database could not be read: database is locked",
      }),
    );
  });

  it("is SESSION_ABSENT without reading the jar when no profile is recorded", async () => {
    const calls: Parameters<typeof readOriginCookies>[0][] = [];
    const readCookies: typeof readOriginCookies = async (input) => {
      calls.push(input);
      return ok([]);
    };

    const error = unwrapErr(
      await readNxCloudSession({ home, origin: ORIGIN, profiles: memoryRecordedProfilePort(), readCookies }),
    );

    expect(calls).toEqual([]);
    expect(error.code).toBe("SESSION_ABSENT");
    expect(error).toEqual(NxCloudAtlasErrors.sessionAbsent({ detail: RealChromeErrors.profileUnset().message }));
  });
});
