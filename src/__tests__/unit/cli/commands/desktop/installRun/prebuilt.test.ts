/**
 * A build `desktop prebuild` left waiting in the stage: `desktop install` claims and installs it only when it
 * is exactly a clean HEAD, signed with the app's identity and carrying the app's own identifier, and otherwise
 * puts it back and builds fresh.
 */
import { describe, expect, it } from "vitest";

import { APP_SUPPORT } from "../../../../../../cli/commands/desktop/installProcess.js";
import { installHeld } from "../../../../../../cli/commands/desktop/installRun.js";
import { takeStage } from "../../../../../../cli/commands/desktop/installStage.js";
import { BUNDLE_ID, INSTALLED_BUNDLE } from "../../../../../../desktop/installPlan.js";
import { stagedBundle, stagePaths } from "../../../../../../desktop/stagedBuild.js";
import { unwrap } from "../../../../../../lib/result.js";
import {
  applications,
  EXPORTED,
  HEAD_ISO,
  HEAD_SHA,
  macWith,
  NONCE,
  READY,
  READY_BUNDLE,
  SHA1,
  stageBuild,
  under,
} from "./fakeMac.js";
import { fakeSeams } from "./seams.js";

describe("installHeld with a prebuilt build", () => {
  it("installs a staged build of exactly HEAD without building anything, then deletes its folder", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    stageBuild({ mac, sha: HEAD_SHA, tag: "new" });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(done.isOk()).toBe(true);
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} new`]);
    expect(mac.lines).toContain("staged: installing the build prebuilt at 461e873ed, so nothing is built now");
    expect(mac.lines.filter((line) => line.startsWith("building:"))).toEqual([]);
    expect(mac.calls).toContain("codesign --verify");
    expect(mac.calls.filter((call) => call === "codesign --sign")).toEqual([]);
    expect(under({ mac, root: `${APP_SUPPORT}/staged` })).toEqual([]);
  });

  it("builds fresh over a staged build of another commit, and leaves that build for the next prebuild", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    stageBuild({ mac, sha: "0123456789abcdef0123456789abcdef01234567", tag: "new" });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(done.isOk()).toBe(true);
    expect(mac.lines).toContain("staged: not used — it is 012345678, not a clean 461e873ed; building instead");
    expect(mac.lines).toContain(`building: ${EXPORTED}`);
    expect(under({ mac, root: READY_BUNDLE })).toEqual([READY_BUNDLE]);
  });

  it("builds fresh over a staged build not signed with the app's identity", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    stageBuild({ mac, sha: HEAD_SHA, tag: "adhoc" });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "runs" }, mac }) });
    expect(done.isOk()).toBe(true);
    expect(mac.lines).toContain("staged: not used — it is not signed with the app's identity; building instead");
    expect(mac.calls).toContain("codesign --sign");
  });

  it("builds fresh over a staged build of HEAD when the checkout carries local desktop edits", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    stageBuild({ mac, sha: HEAD_SHA, tag: "new" });
    const done = await installHeld({
      home: "/home",
      seams: fakeSeams({ behaviour: { dirtyShell: true, launch: "runs" }, mac }),
    });
    expect(done.isOk()).toBe(true);
    expect(mac.lines).toContain("stamp: built from 461e873ed (dirty)");
  });

  it("puts a claimed build back when HEAD moved as it was taken, and builds the new HEAD instead", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    stageBuild({ mac, sha: HEAD_SHA, tag: "new" });
    const done = await installHeld({
      home: "/home",
      seams: fakeSeams({ behaviour: { headMovesAtClaim: true, launch: "runs" }, mac }),
    });
    expect(done.isOk()).toBe(true);
    expect(mac.lines).toContain("staged: not used — it is 461e873ed, not a clean fedcba987; building instead");
    expect(mac.lines).toContain("stamp: built from fedcba987 (clean)");
    expect(mac.lines.filter((line) => line.startsWith("staged: installing"))).toEqual([]);
    expect(under({ mac, root: `${APP_SUPPORT}/staged` })).toEqual([READY_BUNDLE]);
  });

  it("puts back a staged app that is signed and stamped right but is another app, and builds fresh", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    stageBuild({ mac, sha: HEAD_SHA, tag: "new" });
    const done = await installHeld({
      home: "/home",
      seams: fakeSeams({ behaviour: { launch: "runs", stagedForeignId: true }, mac }),
    });
    expect(done.isOk()).toBe(true);
    expect(mac.lines.filter((line) => line.startsWith("staged: not used —"))).toHaveLength(1);
    expect(mac.lines.find((line) => line.startsWith("staged: not used —"))).toContain(
      `its identifier is com.other.app, not ${BUNDLE_ID}`,
    );
    expect(mac.lines).toContain(`building: ${EXPORTED}`);
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} new`]);
    expect(under({ mac, root: `${APP_SUPPORT}/staged` })).toEqual([READY_BUNDLE]);
  });

  it("checks the build it claimed, not the one the stage held before, when another takes its place", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    stageBuild({ mac, sha: HEAD_SHA, tag: "new" });
    const done = await installHeld({
      home: "/home",
      seams: fakeSeams({ behaviour: { launch: "runs", stageReplacedAtClaim: true }, mac }),
    });
    expect(done.isOk()).toBe(true);
    expect(mac.lines).toContain("staged: not used — it is fedcba987, not a clean 461e873ed; building instead");
    expect(mac.lines).toContain(`building: ${EXPORTED}`);
    expect(mac.lines.filter((line) => line.startsWith("staged: installing"))).toEqual([]);
  });
});

describe("takeStage", () => {
  const paths = stagePaths({ appSupport: APP_SUPPORT, nonce: NONCE });
  const head = { committedIso: HEAD_ISO, sha: HEAD_SHA, tree: "clean" as const };

  it("hands back HEAD as read, claiming nothing and saying nothing, when nothing is staged", () => {
    const mac = macWith({ folders: [] });
    const seams = fakeSeams({ behaviour: { launch: "runs" }, mac });
    expect(unwrap(takeStage({ head, paths, root: "/repo", seams, sha1: SHA1 }))).toEqual({ claimed: undefined, head });
    expect(mac.lines).toEqual([]);
  });

  it("claims a staged build of exactly HEAD into this run's own folder, emptying the ready one", () => {
    const mac = macWith({ folders: [] });
    stageBuild({ mac, sha: HEAD_SHA, tag: "new" });
    const seams = fakeSeams({ behaviour: { launch: "runs" }, mac });
    expect(unwrap(takeStage({ head, paths, root: "/repo", seams, sha1: SHA1 }))).toEqual({
      claimed: paths.claimed,
      head,
    });
    expect(under({ mac, root: READY })).toEqual([]);
    expect(under({ mac, root: paths.claimed })).toEqual([stagedBundle({ folder: paths.claimed })]);
  });
});
