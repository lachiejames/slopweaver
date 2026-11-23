/**
 * What `desktop install` builds and how it proves the build is the one it meant: the export of a clean HEAD
 * or the dirty checkout itself, the commit stamp read back out of Info.plist, the System Audio Recording
 * helper, and a checkout edited mid-build — each refused before the installed app is touched.
 */
import { describe, expect, it } from "vitest";

import { installHeld } from "../../../../../../cli/commands/desktop/installRun.js";
import type { InstallSeams } from "../../../../../../cli/commands/desktop/installSeams.js";
import { verifyStamp } from "../../../../../../cli/commands/desktop/installStamp.js";
import { stampArgs } from "../../../../../../desktop/buildStamp.js";
import { INSTALLED_BUNDLE } from "../../../../../../desktop/installPlan.js";
import { unwrapErr } from "../../../../../../lib/result.js";
import {
  applications,
  type Behaviour,
  EXPORTED,
  HEAD_ISO,
  HEAD_SHA,
  HELPER,
  MAIN,
  macWith,
  OUTPUT,
  plistOf,
  under,
} from "./fakeMac.js";
import { fakeSeams } from "./seams.js";

describe("installHeld", () => {
  it("replaces the previous app once the new build runs, leaving one copy and no hidden folder", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(done.isOk()).toBe(true);
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} new`]);
    expect(mac.lines.at(-1)).toBe(`opened: running from ${INSTALLED_BUNDLE} for 10s, serving ${MAIN}`);
    expect(under({ mac, root: OUTPUT })).toEqual([]);
  });

  it("stamps the build with the commit it was made from and says so", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(done.isOk()).toBe(true);
    expect(mac.lines).toContain("stamp: built from 461e873ed (clean)");
  });

  it("builds a clean HEAD from an export of its commit, so nothing outside the commit goes in", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(done.isOk()).toBe(true);
    expect(mac.lines).toContain(`building: ${EXPORTED}`);
  });

  it("exports the root files the committed desktop scripts reach, so `../scripts/tsc-owner.sh` is in the copy", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(done.isOk()).toBe(true);
    const exported = mac.gitCalls.filter((call) => /^(show|ls-tree|archive) /u.test(call));
    expect(exported).toEqual([
      `show ${HEAD_SHA}:desktop/package.json`,
      `ls-tree -r ${HEAD_SHA} -- :(literal)desktop :(literal)scripts/tsc-owner.sh`,
      `archive --format=tar -o ${EXPORTED}.tar ${HEAD_SHA} -- :(literal)desktop :(literal)scripts/tsc-owner.sh`,
    ]);
  });

  it("empties an export folder a killed run left under the same pid before exporting into it", async () => {
    const mac = macWith({
      folders: [
        [INSTALLED_BUNDLE, "old", 1],
        [`${EXPORTED}/src/removed.ts`, "stale", 1],
      ],
    });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(done.isOk()).toBe(true);
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} new`]);
  });

  it("stamps a build carrying uncommitted desktop changes as dirty, built in the checkout itself", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const behaviour: Behaviour = { dirtyShell: true, launch: "runs" };
    expect((await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) })).isOk()).toBe(true);
    expect(mac.lines).toContain("stamp: built from 461e873ed (dirty)");
    expect(mac.lines).toContain("building: /repo/desktop");
  });

  it("refuses a build that does not carry its stamp, before the installed app is touched", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const done = await installHeld({
      home: "/home",
      seams: fakeSeams({ behaviour: { launch: "runs", unstamped: true }, mac }),
    });
    expect(unwrapErr(done).code).toBe("STAMP_MISSING");
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} old`]);
    expect(mac.calls).not.toContain("codesign --sign");
  });

  it("checks the build carries its System Audio Recording helper, executable, before signing it", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(done.isOk()).toBe(true);
    const checked = mac.calls.indexOf(`test -f ${HELPER} -a -x ${HELPER} -a ! -L ${HELPER}`);
    expect(checked).toBeGreaterThan(-1);
    expect(checked).toBeLessThan(mac.calls.indexOf("codesign --sign"));
  });

  it("refuses a build without its System Audio Recording helper, before the installed app is touched", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const done = await installHeld({
      home: "/home",
      seams: fakeSeams({ behaviour: { helperMissing: true, launch: "runs" }, mac }),
    });
    expect(unwrapErr(done).code).toBe("BUNDLE_INVALID");
    expect(unwrapErr(done).message).toContain(
      "it has no executable System Audio Recording helper at Contents/MacOS/slopweaver-system-audio",
    );
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} old`]);
    expect(mac.calls).not.toContain("codesign --sign");
  });

  it("refuses a build once the checkout is edited while it compiled, before the installed app is touched", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const behaviour: Behaviour = { editedDuringBuild: true, launch: "runs" };
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) });
    expect(unwrapErr(done).message).toBe(
      "the checkout moved from 461e873ed (clean) to 461e873ed (dirty) while the app built, so the build is of neither — run it again — from `git status after the build`",
    );
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} old`]);
    expect(mac.calls).not.toContain("codesign --sign");
    expect(under({ mac, root: OUTPUT })).toEqual([]);
  });
});

describe("verifyStamp", () => {
  const BUILT = "/tmp/build/mac-arm64/Slopweaver.app";
  const stamp = { committedIso: HEAD_ISO, sha: HEAD_SHA, tree: "clean" } as const;

  /** A fake Mac whose built bundle's Info.plist is `plist`. */
  const seamsWith = ({ plist }: { plist: string }): InstallSeams => {
    const mac = macWith({ folders: [] });
    mac.files.set(`${BUILT}/Contents/Info.plist`, plist);
    return fakeSeams({ behaviour: { launch: "runs" }, mac });
  };

  it("passes a bundle carrying exactly the stamp it was built with", () => {
    const plist = plistOf({
      behaviour: { launch: "runs" },
      call: { args: ["app", ...stampArgs({ stamp })], command: "yarn" },
    });
    expect(verifyStamp({ bundle: BUILT, seams: seamsWith({ plist }), stamp }).isOk()).toBe(true);
  });

  it("refuses a bundle stamped with another commit, naming both", () => {
    const plist = plistOf({
      behaviour: { launch: "runs" },
      call: { args: ["app", ...stampArgs({ stamp: { ...stamp, sha: "b".repeat(40) } })], command: "yarn" },
    });
    const refused = unwrapErr(verifyStamp({ bundle: BUILT, seams: seamsWith({ plist }), stamp }));
    expect(refused.code).toBe("STAMP_MISSING");
    expect(refused.message).toContain(`it names ${"b".repeat(40)}, not ${HEAD_SHA}`);
  });
});
