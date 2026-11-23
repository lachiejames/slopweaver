/**
 * When a swap goes wrong `desktop install` never leaves the Mac without an app: a build that never runs is
 * rolled back, a backup an interrupted install left is restored on the next run, and a part-deleted copy is
 * finished off rather than put back.
 */
import { describe, expect, it } from "vitest";

import { GRANTED_REQUIREMENT } from "../../../../../../cli/commands/desktop/installProcess.js";
import { installHeld } from "../../../../../../cli/commands/desktop/installRun.js";
import { discardBackup } from "../../../../../../cli/commands/desktop/installSwap.js";
import { BUNDLE_ID, INSTALLED_BUNDLE } from "../../../../../../desktop/installPlan.js";
import { unwrapErr } from "../../../../../../lib/result.js";
import { applications, type Behaviour, LEAF, macWith, NONCE } from "./fakeMac.js";
import { fakeSeams } from "./seams.js";

describe("installHeld", () => {
  it("puts the previous app back when the new build never runs", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "never" }, mac }) });
    expect(unwrapErr(done).code).toBe("ROLLED_BACK");
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} old`]);
  });

  it("puts the new build back rather than leave no app when the previous one cannot be moved back", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const behaviour: Behaviour = { launch: "never", unmovable: `/Applications/.Slopweaver-previous-${NONCE}` };
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) });
    expect(unwrapErr(done).message).toContain("could not put the previous app back");
    expect(applications({ mac })).toEqual([
      `/Applications/.Slopweaver-previous-${NONCE} old`,
      `${INSTALLED_BUNDLE} new`,
    ]);
  });

  it("keeps a first install's new build when it never runs, with nothing to put back", async () => {
    const mac = macWith({ folders: [] });
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour: { launch: "never" }, mac }) });
    expect(unwrapErr(done).code).toBe("NEVER_RAN");
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} new`]);
  });

  it("restores the oldest backup an interrupted install left, before a later step fails", async () => {
    const mac = macWith({
      folders: [
        [INSTALLED_BUNDLE, "unvalidated", 5],
        ["/Applications/.Slopweaver-previous-1", "last-good", 1],
        ["/Applications/.Slopweaver-previous-2", "overlapping", 2],
        ["/Applications/.Slopweaver-installing-3", "staged", 3],
      ],
    });
    const behaviour: Behaviour = { launch: "runs", yarnFails: true };
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) });
    expect(unwrapErr(done).code).toBe("STEP_FAILED");
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} last-good`]);
    expect(mac.lines[0]).toBe(
      "recovered: an interrupted install never saw its new build run, so the previous app is back (.Slopweaver-previous-1)",
    );
  });

  it("clears the grants when recovery puts back a build signed differently, even if the run then stops", async () => {
    const mac = macWith({
      folders: [
        [INSTALLED_BUNDLE, "new", 2],
        ["/Applications/.Slopweaver-previous-1", "old", 1],
      ],
    });
    mac.files.set(GRANTED_REQUIREMENT, `${LEAF}\n`);
    const behaviour: Behaviour = { launch: "runs", yarnFails: true };
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) });
    expect(unwrapErr(done).code).toBe("STEP_FAILED");
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} old`]);
    expect(mac.calls.filter((call) => call.startsWith("tccutil "))).toEqual([`tccutil reset All ${BUNDLE_ID}`]);
    expect(mac.lines.slice(0, 2)).toEqual([
      "recovered: an interrupted install never saw its new build run, so the previous app is back (.Slopweaver-previous-1)",
      "permissions: the app put back is signed differently from the build it displaced, so its macOS grants were cleared and it asks for the microphone, System Audio Recording and Screen Recording once more",
    ]);
  });

  it("keeps the grants when recovery puts back a build signed the same way", async () => {
    const mac = macWith({
      folders: [
        [INSTALLED_BUNDLE, "new", 2],
        ["/Applications/.Slopweaver-previous-1", "new", 1],
      ],
    });
    const behaviour: Behaviour = { launch: "runs", yarnFails: true };
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) });
    expect(unwrapErr(done).code).toBe("STEP_FAILED");
    expect(mac.calls.filter((call) => call.startsWith("tccutil "))).toEqual([]);
  });

  it("keeps the installed build in place when an interrupted install's backup will not move back", async () => {
    const mac = macWith({
      folders: [
        [INSTALLED_BUNDLE, "unvalidated", 2],
        ["/Applications/.Slopweaver-previous-1", "old", 1],
      ],
    });
    const behaviour: Behaviour = { launch: "runs", unmovable: "/Applications/.Slopweaver-previous-1" };
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) });
    expect(unwrapErr(done).message).toContain("could not put the previous app back");
    expect(applications({ mac })).toEqual([
      "/Applications/.Slopweaver-previous-1 old",
      `${INSTALLED_BUNDLE} unvalidated`,
    ]);
  });

  it("leaves a part-deleted previous copy to be deleted by the next install, never restored", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const discarded = `/Applications/.Slopweaver-discarded-${NONCE}`;
    const first = await installHeld({
      home: "/home",
      seams: fakeSeams({ behaviour: { launch: "runs", undeletable: discarded }, mac }),
    });
    expect(unwrapErr(first).code).toBe("REPLACE_FAILED");
    expect(applications({ mac })).toEqual([`${discarded} old`, `${INSTALLED_BUNDLE} new`]);
    mac.running.clear();
    const second = await installHeld({
      home: "/home",
      seams: fakeSeams({ behaviour: { launch: "runs", yarnFails: true }, mac }),
    });
    expect(unwrapErr(second).code).toBe("STEP_FAILED");
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} new`]);
  });

  it("moves the previous app straight back when the new build cannot be moved into place", async () => {
    const mac = macWith({ folders: [[INSTALLED_BUNDLE, "old", 1]] });
    const behaviour: Behaviour = { launch: "runs", unmovable: `/Applications/.Slopweaver-installing-${NONCE}` };
    const done = await installHeld({ home: "/home", seams: fakeSeams({ behaviour, mac }) });
    expect(unwrapErr(done).code).toBe("REPLACE_FAILED");
    expect(applications({ mac })).toEqual([`${INSTALLED_BUNDLE} old`]);
  });
});

describe("discardBackup", () => {
  it("moves the backup to the discarded name before deleting it", () => {
    const mac = macWith({ folders: [["/Applications/.Slopweaver-previous-1", "old", 1]] });
    const discarded = `/Applications/.Slopweaver-discarded-${NONCE}`;
    const seams = fakeSeams({ behaviour: { launch: "runs", undeletable: discarded }, mac });
    expect(unwrapErr(discardBackup({ backup: "/Applications/.Slopweaver-previous-1", seams })).code).toBe(
      "REPLACE_FAILED",
    );
    expect(applications({ mac })).toEqual([`${discarded} old`]);
  });
});
