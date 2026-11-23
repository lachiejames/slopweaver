/**
 * The verb's half of one desktop look refused by macOS Screen Recording: from the screen flag the console's route
 * spawns `talk relay` with, through the verb's parse and the picture it prepares, to the words the row reads.
 *
 * `site/__tests__/unit/screenRecordingRelayChain.test.ts` walks the console's half — the shell's reply to these exact
 * flags — and the chain is cut there because the site's typecheck cannot hold `src/cli`. Each module has its own
 * test; this one exists because each can pass while a field is accepted at one boundary and dropped at the next
 * (a boundary the chain once crossed unnoticed).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseRelayArgs } from "../../../cli/commands/talk/relayArgs.js";
import { unwrap } from "../../../lib/result.js";
import { pictureClause } from "../../../talk/relayAskText.js";
import { prepareRelayPicture } from "../../../talk/relayPicture.js";

const TURN = "a0000017-0000-4000-8000-000000000019";

describe("a native look Screen Recording refused, from the argv to the row", () => {
  const homes: string[] = [];
  afterEach(() => {
    homes.splice(0).forEach((home) => {
      rmSync(home, { force: true, recursive: true });
    });
  });

  /** The picture clause a relay spawned with this screen flag files on the row. */
  const clauseFor = ({ flag }: { flag: string }): string => {
    const home = mkdtempSync(join(tmpdir(), "sw-chain-"));
    homes.push(home);
    const args = unwrap(parseRelayArgs({ rest: ["--turn", TURN, "--say", "I could not see your screen", flag] }));
    const prepared = unwrap(
      prepareRelayPicture({
        home,
        screenFailed: args.screenFailed,
        screenNotTaken: args.screenNotTaken,
        screenRecordingOff: args.screenRecordingOff,
        sourcePath: args.screen,
        turnId: args.turn,
        typed: args.typed,
      }),
    );
    return pictureClause({ picture: prepared.picture, typed: false });
  };

  it("reaches the row as the permission to grant, never as a share that gave no frame", () => {
    expect(clauseFor({ flag: "--screen-recording-off" })).toBe(
      "No picture: macOS Screen Recording is off for the desktop app, so it could not look at the owner's screen. Turn on Slopweaver in System Settings › Privacy & Security › Screen & System Audio Recording, then quit and reopen it (already on? remove it with −, and the next look asks again). A device policy can block it too, and only its administrator can lift that.",
    );
  });

  it("keeps a look that gave no frame as exactly that", () => {
    expect(clauseFor({ flag: "--screen-failed" })).toBe("No picture: the look at the owner's screen gave no frame.");
  });
});
