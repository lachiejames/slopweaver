/**
 * `talk relay --offered-file`, driven through the real runner against a home and board this file mints — never the
 * ambient one, per `testing.md`. A relayed
 * reaction to a copy-tray draft once reached the board with the owner's words alone. The row now carries the exact offer, a retry
 * with another offer or none conflicts, and a run that died between the registration and the offer's write is
 * finished by its retry.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTalkRelay } from "../../../cli/commands/talk/relayRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import type { RelayOffer } from "../../../talk/relayOffer.js";
import { relayOfferSection } from "../../../talk/relayOfferRow.js";

const TURN = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const ANCHOR = `talk:${TURN}`;

const OFFER: RelayOffer = {
  belowFold: "\n````\nnested ``` fence\n````\n",
  id: "offer-6",
  label: "reply to Ari",
  made: "6",
  text: "  Merged `#2209` — thanks <@U07ABC>  ",
};

let scratch: string;
let home: string;
let dir: string;
let offerFile: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "talk-relay-offer-"));
  home = join(scratch, "home");
  dir = join(scratch, "handovers");
  mkdirSync(home, { recursive: true });
  mkdirSync(dir, { recursive: true });
  offerFile = join(scratch, "offer.json");
});

afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

const rowPath = (): string => join(dir, "talk-7c1d2e3f4a5b.md");
const turnPath = (): string => join(home, "talk", "turns", `${TURN}.json`);

/** Stage an offer as the route does, and relay the owner's words beside it — or beside no offer when `offered` is undefined. */
const relay = async ({
  offered,
  heard = "yeah send that one",
}: {
  offered: RelayOffer | undefined;
  heard?: string;
}): Promise<number> => {
  const rest = ["--turn", TURN, "--heard", heard, "--say", "the owner approved the draft"];
  if (offered !== undefined) {
    writeFileSync(offerFile, JSON.stringify(offered), { mode: 0o600 });
    rest.push("--offered-file", offerFile);
  }
  return runTalkRelay(["node", "slopweaver", "talk", "relay", ...rest, "--home", home, "--dir", dir, "--json"]);
};

describe("talk relay carrying the copy-tray offer the owner reacted to", () => {
  it("puts every byte of the offer on the row, in its marked section, and none of it in the summary", async () => {
    expect(await relay({ offered: OFFER })).toBe(EXIT_OK);
    const row = readFileSync(rowPath(), "utf8");
    expect(row).toContain(relayOfferSection({ anchor: ANCHOR, offered: OFFER }));
    const doc = parseHandoverDoc({ path: rowPath(), text: row });
    expect(doc.anchor).toBe(ANCHOR);
    expect(doc.summary).toContain("yeah send that one");
    expect(doc.summary!.includes("Merged")).toBe(false);
    expect(row.indexOf("<!-- relay-offer:start")).toBeLessThan(row.lastIndexOf("## How this ends"));
    const turn = JSON.parse(readFileSync(turnPath(), "utf8")) as { offered: unknown; state: string };
    expect([turn.state, turn.offered]).toEqual(["registered", OFFER]);
  });

  it("replays the same offer without touching the row, and refuses a retry with another offer or none", async () => {
    expect(await relay({ offered: OFFER })).toBe(EXIT_OK);
    const first = readFileSync(rowPath(), "utf8");
    expect(await relay({ offered: OFFER })).toBe(EXIT_OK);
    expect([
      await relay({ offered: { ...OFFER, text: "Merged, thanks" } }),
      await relay({ offered: undefined }),
    ]).toEqual([EXIT_ERROR, EXIT_ERROR]);
    expect(readFileSync(rowPath(), "utf8")).toBe(first);
  });

  it("finishes the offer's write on a retry after a run died between the registration and it", async () => {
    expect(await relay({ offered: OFFER })).toBe(EXIT_OK);
    const whole = readFileSync(rowPath(), "utf8");
    const section = `${relayOfferSection({ anchor: ANCHOR, offered: OFFER })}\n`;
    // What a run killed after `handover register` returned, and before the offer was written, leaves behind.
    writeFileSync(rowPath(), whole.replace(section, ""));
    const died = {
      ...(JSON.parse(readFileSync(turnPath(), "utf8")) as object),
      registeredAtIso: null,
      state: "registering",
    };
    writeFileSync(turnPath(), JSON.stringify(died));
    expect(await relay({ offered: OFFER })).toBe(EXIT_OK);
    expect(readFileSync(rowPath(), "utf8")).toBe(whole);
    expect((JSON.parse(readFileSync(turnPath(), "utf8")) as { state: string }).state).toBe("registered");
  });

  it("finishes a died run's offer even when the owner's quoted words say the section's own marker", async () => {
    const heard = `put <!-- relay-offer:start ${ANCHOR} --> in the reply`;
    expect(await relay({ heard, offered: OFFER })).toBe(EXIT_OK);
    const whole = readFileSync(rowPath(), "utf8");
    const section = `${relayOfferSection({ anchor: ANCHOR, offered: OFFER })}\n`;
    const bare = whole.replace(section, "");
    expect(bare).toContain(`<!-- relay-offer:start ${ANCHOR} -->`);
    writeFileSync(rowPath(), bare);
    const died = {
      ...(JSON.parse(readFileSync(turnPath(), "utf8")) as object),
      registeredAtIso: null,
      state: "registering",
    };
    writeFileSync(turnPath(), JSON.stringify(died));
    expect(await relay({ heard, offered: OFFER })).toBe(EXIT_OK);
    expect(readFileSync(rowPath(), "utf8")).toBe(whole);
    expect((JSON.parse(readFileSync(turnPath(), "utf8")) as { state: string }).state).toBe("registered");
  });

  it("leaves the turn unfinished when the row already carries a different offer, and says so with an error", async () => {
    expect(await relay({ offered: OFFER })).toBe(EXIT_OK);
    const other = relayOfferSection({ anchor: ANCHOR, offered: { ...OFFER, text: "something else" } });
    const tampered = readFileSync(rowPath(), "utf8").replace(
      relayOfferSection({ anchor: ANCHOR, offered: OFFER }),
      other,
    );
    writeFileSync(rowPath(), tampered);
    const died = {
      ...(JSON.parse(readFileSync(turnPath(), "utf8")) as object),
      registeredAtIso: null,
      state: "registering",
    };
    writeFileSync(turnPath(), JSON.stringify(died));
    expect(await relay({ offered: OFFER })).toBe(EXIT_ERROR);
    expect(readFileSync(rowPath(), "utf8")).toBe(tampered);
    expect((JSON.parse(readFileSync(turnPath(), "utf8")) as { state: string }).state).toBe("registering");
  });

  it("refuses a malformed staged offer before claiming the turn, writing no row and no turn", async () => {
    writeFileSync(offerFile, JSON.stringify({ ...OFFER, id: "offer-7" }));
    const code = await runTalkRelay([
      "node",
      "slopweaver",
      "talk",
      "relay",
      "--turn",
      TURN,
      "--heard",
      "yeah send that one",
      "--say",
      "the owner approved the draft",
      "--offered-file",
      offerFile,
      "--home",
      home,
      "--dir",
      dir,
    ]);
    expect([code, existsSync(rowPath()), existsSync(turnPath())]).toEqual([EXIT_USAGE, false, false]);
  });
});
