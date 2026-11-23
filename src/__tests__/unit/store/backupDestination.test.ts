/**
 * Where an encrypted backup lands: whether it shares a device with the home or overlaps a plaintext place, and how
 * `--from` names one — a staging directory or a `<root>/<project>/<instant>` destination.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  type DeviceOf,
  parseBackupSourceAddress,
  refusePlaintextInsideDestination,
  sharesDeviceWithHome,
} from "../../../store/backup/destination.js";
import { BackupErrors } from "../../../store/backup/errors.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

// The one-destination reader left with its cases, which now hold the list down in backupDestinationConfig.test.ts.
// deleted-with-code: backupDirectory
const INSTANT = "2026-11-03T09-53-54-869Z";

describe("sharesDeviceWithHome", () => {
  // A seam, not a mock: a table of which device each existing path sits on.
  const devices = new Map<string, number>([
    ["/", 1],
    ["/Users/me/.slopweaver", 1],
    ["/Volumes/External", 2],
  ]);
  const deviceOf: DeviceOf = ({ path }) => {
    const found = devices.get(path);
    if (found === undefined) {
      return null;
    }
    return found;
  };

  it("says one device when the destination is under the same disk as the home", () => {
    expect(sharesDeviceWithHome({ deviceOf, home: "/Users/me/.slopweaver", root: "/Users/me/backups" })).toBe(true);
  });

  it("says two devices for a destination on another volume, judged by its nearest existing ancestor", () => {
    expect(
      sharesDeviceWithHome({ deviceOf, home: "/Users/me/.slopweaver", root: "/Volumes/External/not-yet/made" }),
    ).toBe(false);
  });

  it("says it does not know when no ancestor's device can be read", () => {
    const unreadable: DeviceOf = () => {
      throw new Error("EACCES");
    };
    expect(sharesDeviceWithHome({ deviceOf: unreadable, home: "/h", root: "/r" })).toBe(null);
  });
});

describe("parseBackupSourceAddress", () => {
  it("reads <root>/<project>/<instant> as a destination address", () => {
    expect(
      unwrap(parseBackupSourceAddress({ from: `/Volumes/b/slopweaver/${INSTANT}`, project: "slopweaver" })),
    ).toEqual({
      display: `/Volumes/b/slopweaver/${INSTANT}`,
      kind: "local-destination",
      prefix: `slopweaver/${INSTANT}/`,
      root: "/Volumes/b",
    });
  });

  it("reads the same address spelled as a file:// URL with a trailing slash", () => {
    const parsed = unwrap(
      parseBackupSourceAddress({ from: `file:///Volumes/my%20backups/slopweaver/${INSTANT}/`, project: "slopweaver" }),
    );
    expect(parsed).toEqual({
      display: `/Volumes/my backups/slopweaver/${INSTANT}`,
      kind: "local-destination",
      prefix: `slopweaver/${INSTANT}/`,
      root: "/Volumes/my backups",
    });
  });

  it("reads any other absolute path as a staging directory", () => {
    expect(unwrap(parseBackupSourceAddress({ from: `/h/store-backups/${INSTANT}/`, project: "slopweaver" }))).toEqual({
      directory: `/h/store-backups/${INSTANT}`,
      kind: "staging",
    });
  });

  it("refuses a relative path, a climb, a query and a fragment, each with its reason", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["slopweaver/x", "it is not an absolute path"],
      [`/a/../slopweaver/${INSTANT}`, "it climbs with a .. segment"],
      [`file:///a/../slopweaver/${INSTANT}`, "it climbs with a .. segment"],
      [`file:///a/slopweaver/${INSTANT}?x=1`, "a file:// address carries no query or fragment"],
      [`file:///a/slopweaver/${INSTANT}#frag`, "a file:// address carries no query or fragment"],
      ["file://remote-host/a/b", "File URL host must be"],
    ];
    expect(cases.length).toBeGreaterThan(0);
    for (const [from, why] of cases) {
      const refused = unwrapErr(parseBackupSourceAddress({ from, project: "slopweaver" }));
      expect(refused.code).toBe("SOURCE_ADDRESS_INVALID");
      expect(refused.message).toContain(why);
    }
  });

  it("refuses a path under the project directory whose last segment is not a backup instant", () => {
    const refused = unwrapErr(parseBackupSourceAddress({ from: "/a/slopweaver/latest", project: "slopweaver" }));
    expect(refused.message).toBe(
      '"/a/slopweaver/latest" is not a restore source: it sits under a slopweaver/ directory but "latest" is not a backup instant',
    );
  });
});

describe("a destination never overlaps a place a run writes plaintext to", () => {
  /**
   * A scratch directory holding `home/` and a link `alias` → `home`, removed after the test.
   *
   * @returns the scratch directory and the home inside it
   */
  function scratchWithLink(): { scratch: string; home: string } {
    const scratch = mkdtempSync(join(tmpdir(), "backup-overlap-"));
    homes.push(scratch);
    const home = join(scratch, "home");
    mkdirSync(home);
    symlinkSync(home, join(scratch, "alias"));
    return { home, scratch };
  }

  it("refuses the destination equal to the home — the counterexample that staged plaintext inside it", () => {
    const { home } = scratchWithLink();
    const refused = unwrapErr(
      refusePlaintextInsideDestination({ places: [{ path: home, role: "the Slopweaver home" }], root: home }),
    );
    expect(refused).toEqual(
      BackupErrors.destinationOverlaps({ destination: home, path: home, role: "the Slopweaver home" }),
    );
  });

  it("refuses a place inside the destination, and a destination not made yet inside the home", () => {
    const { scratch, home } = scratchWithLink();
    const destination = join(scratch, "destination");
    mkdirSync(destination);
    const below = refusePlaintextInsideDestination({
      places: [{ path: join(destination, "collateral"), role: "--secrets-into" }],
      root: destination,
    });
    expect(unwrapErr(below)).toEqual(
      BackupErrors.destinationOverlaps({
        destination,
        path: join(destination, "collateral"),
        role: "--secrets-into",
      }),
    );
    const notYet = refusePlaintextInsideDestination({
      places: [{ path: home, role: "the Slopweaver home" }],
      root: join(home, "made", "later"),
    });
    expect(unwrapErr(notYet).code).toBe("DESTINATION_OVERLAPS");
  });

  it("refuses a destination spelled through a link to the home", () => {
    const { scratch, home } = scratchWithLink();
    const linked = join(scratch, "alias", "dest");
    const refused = refusePlaintextInsideDestination({
      places: [{ path: home, role: "the Slopweaver home" }],
      root: linked,
    });
    expect(unwrapErr(refused)).toEqual(
      BackupErrors.destinationOverlaps({ destination: linked, path: home, role: "the Slopweaver home" }),
    );
  });

  it("refuses rather than passes when a side cannot be resolved — a link pointing at nothing", () => {
    const { scratch, home } = scratchWithLink();
    symlinkSync(join(scratch, "gone"), join(scratch, "dangling"));
    const refused = refusePlaintextInsideDestination({
      places: [{ path: home, role: "the Slopweaver home" }],
      root: join(scratch, "dangling", "dest"),
    });
    expect(unwrapErr(refused).code).toBe("BACKUP_STEP_FAILED");
  });

  it("passes a destination beside every place the run writes, including a sibling sharing a name prefix", () => {
    const { scratch, home } = scratchWithLink();
    const clear = refusePlaintextInsideDestination({
      places: [
        { path: home, role: "the Slopweaver home" },
        { path: join(scratch, "restored-secrets"), role: "--secrets-into" },
      ],
      root: `${home}-backups`,
    });
    expect(clear.isOk()).toBe(true);
    expect(unwrap(clear)).toBeUndefined();
  });
});
