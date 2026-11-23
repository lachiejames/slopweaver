/**
 * The signing identity and the macOS grants that hang off it: `desktop install` mints the identity once, signs
 * every build with it, clears an ad-hoc build's grants exactly when the signature changes, and records that
 * clear only once nothing could put a differently signed app back.
 */
import { describe, expect, it } from "vitest";

import { GRANTED_REQUIREMENT } from "../../../../../../cli/commands/desktop/installProcess.js";
import { installHeld } from "../../../../../../cli/commands/desktop/installRun.js";
import type { InstallSeams } from "../../../../../../cli/commands/desktop/installSeams.js";
import { grantedRequirement, recordGrantClear } from "../../../../../../cli/commands/desktop/installSigning.js";
import { BUNDLE_ID, INSTALLED_BUNDLE } from "../../../../../../desktop/installPlan.js";
import { unwrapErr } from "../../../../../../lib/result.js";
import { applications, type Behaviour, HELPER, LEAF, macWith, NONCE } from "./fakeMac.js";
import { fakeSeams } from "./seams.js";

describe("installHeld", () => {
  it("mints the identity, signs the build, and clears an ad-hoc build's grants before the new build opens", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(done.isOk()).toBe(true);
    expect(mac.calls.filter((call) => !call.startsWith("security "))).toEqual([
      "openssl",
      `test -f ${HELPER} -a -x ${HELPER} -a ! -L ${HELPER}`,
      "codesign --sign",
      `tccutil reset All ${BUNDLE_ID}`,
      "open",
    ]);
    expect(mac.lines).toContain(`built: ${BUNDLE_ID} build 42, signed ${LEAF}`);
    expect(mac.lines).toContain(
      "permissions: the app's signature changed, so its old macOS grants were cleared — the microphone, System Audio Recording and Screen Recording are asked for once more, then kept across rebuilds",
    );
    expect(mac.files.get(GRANTED_REQUIREMENT)).toBe(`${LEAF}\n`);
  });

  it("keeps every grant on a rebuild once they were cleared for the identity, and mints it only once", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const first = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(first.isOk()).toBe(true);
    mac.running.clear();
    mac.calls.length = 0;
    const second = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(second.isOk()).toBe(true);
    expect(mac.calls.filter((call) => !call.startsWith("security "))).toEqual([
      `test -f ${HELPER} -a -x ${HELPER} -a ! -L ${HELPER}`,
      "codesign --sign",
      "open",
    ]);
  });

  it("owes the clear again when it failed, rather than reading the signed build in place as current", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const failing = fakeSeams({ behaviour: { launch: "runs", tccFails: true }, mac });
    expect((await installHeld({ home: "/home", seams: failing })).isOk()).toBe(true);
    expect(mac.files.has(GRANTED_REQUIREMENT)).toBe(false);
    expect(mac.lines.some((line) => line.includes("so the next install tries again"))).toBe(true);
    mac.running.clear();
    mac.calls.length = 0;
    expect(
      (await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) })).isOk(),
    ).toBe(true);
    expect(mac.calls).toContain(`tccutil reset All ${BUNDLE_ID}`);
    expect(mac.files.get(GRANTED_REQUIREMENT)).toBe(`${LEAF}\n`);
  });

  it("says the app it put back asks again, and owes the clear to the next install, after a rollback", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "never" }, mac }) });
    expect(unwrapErr(done).code).toBe("ROLLED_BACK");
    expect(unwrapErr(done).message).toContain(
      "its macOS grants were cleared before the failure, so it asks for the microphone, System Audio Recording and Screen Recording once more",
    );
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} old`]);
    // The app put back may be granted afresh under its own requirement before the next install, so nothing records
    // the clear and the next install makes it again.
    expect(mac.files.has(GRANTED_REQUIREMENT)).toBe(false);
    mac.running.clear();
    mac.calls.length = 0;
    expect(
      (await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) })).isOk(),
    ).toBe(true);
    expect(mac.calls).toContain(`tccutil reset All ${BUNDLE_ID}`);
    expect(mac.files.get(GRANTED_REQUIREMENT)).toBe(`${LEAF}\n`);
  });

  it("records no clear while a backup a later recovery could put back survives", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const behaviour: Behaviour = { launch: "runs", unmovable: `/Applications/.Slopweaver-previous-${NONCE}` };
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) });
    expect(unwrapErr(done).code).toBe("REPLACE_FAILED");
    expect(mac.calls).toContain(`tccutil reset All ${BUNDLE_ID}`);
    expect(mac.files.has(GRANTED_REQUIREMENT)).toBe(false);
  });

  it("clears the grants when the build it replaces is not the identity's, though the record matches", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    mac.files.set(GRANTED_REQUIREMENT, `${LEAF}\n`);
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(done.isOk()).toBe(true);
    expect(mac.calls).toContain(`tccutil reset All ${BUNDLE_ID}`);
  });

  it("names the signing when the key's temporary folder cannot be made, before anything is built", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const seams: InstallSeams = {
      ...fakeSeams({ behaviour: { launch: "runs" }, mac }),
      tempFolder: () => {
        throw new Error("ENOSPC");
      },
    };
    const done = await installHeld({ home: "/home", seams });
    expect(unwrapErr(done).code).toBe("SIGNING_FAILED");
    expect(unwrapErr(done).message).toContain("could not make a temporary folder for the key: ENOSPC");
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} old`]);
  });

  it("refuses a build whose signature does not read back as the identity's, leaving the install untouched", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const behaviour: Behaviour = { launch: "runs", signsAdHoc: true };
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) });
    expect(unwrapErr(done).code).toBe("SIGNING_FAILED");
    expect(unwrapErr(done).message).toContain(`the signed build's requirement reads cdhash H"new", not ${LEAF}`);
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} old`]);
    expect(mac.calls).not.toContain(`tccutil reset All ${BUNDLE_ID}`);
  });
});

describe("the grant record", () => {
  it("says an unreadable record and counts it as none, so the grants are cleared once more", () => {
    const mac = macWith({ folders: [] });
    mac.files.set(GRANTED_REQUIREMENT, `${LEAF}\n`);
    const seams: InstallSeams = {
      ...fakeSeams({ behaviour: { launch: "runs" }, mac }),
      readText: () => {
        throw new Error("EACCES");
      },
    };
    expect(grantedRequirement({ record: GRANTED_REQUIREMENT, seams })).toBe(undefined);
    expect(mac.lines).toEqual([
      `permissions: could not read ${GRANTED_REQUIREMENT}: EACCES, so the app's macOS grants are cleared once more`,
    ]);
  });

  it("names an unwritable record, so the next install clears once more", () => {
    const mac = macWith({ folders: [] });
    const seams: InstallSeams = {
      ...fakeSeams({ behaviour: { launch: "runs" }, mac }),
      writeText: () => {
        throw new Error("ENOSPC");
      },
    };
    expect(recordGrantClear({ record: GRANTED_REQUIREMENT, requirement: LEAF, seams })).toBe(
      `permissions: could not record the cleared requirement in ${GRANTED_REQUIREMENT}: ENOSPC, so the next install clears the grants once more`,
    );
  });
});
