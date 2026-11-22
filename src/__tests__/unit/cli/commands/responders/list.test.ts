/**
 * `slopweaver responders list` — who may address the bot, in one call. The render is pure and tested with no I/O;
 * the run function round-trips a real temp home holding `responders.json` and the Slack member rows.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseRespondersListArgs,
  renderResponderList,
  responderListLines,
  respondersListCommand,
  runRespondersList,
} from "../../../../../cli/commands/responders/list.js";
import { runRespondersAdd } from "../../../../../cli/commands/responders/run.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { respondersManifest } from "../../../../../cli/manifests/responders.js";
import { buildMemberIdentity } from "../../../../../corpus/members/email.js";
import { slackMemberNames } from "../../../../../corpus/members/slackNames.js";
import { writeMemberRows } from "../../../../../corpus/members/store.js";
import type { MemberBronzeRow } from "../../../../../corpus/members/types.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { NO_PROTECTION } from "../../../../noProtection.js";

describe("renderResponderList", () => {
  it("names each admitted id from the member rows, in list order, and leaves an unknown id unnamed", () => {
    const listing = renderResponderList({
      names: { U0SYNAAA: "Ari" },
      whitelist: { identities: ["U0SYNBBB", "U0SYNAAA"], kind: "list" },
    });
    expect(listing).toEqual({
      responders: [
        { id: "U0SYNBBB", name: null },
        { id: "U0SYNAAA", name: "Ari" },
      ],
      state: "list",
    });
  });

  it("leaves an id spelled like an Object-prototype member unnamed, never naming it from the prototype", () => {
    const listing = renderResponderList({ names: {}, whitelist: { identities: ["toString"], kind: "list" } });
    expect(JSON.stringify(listing)).toBe('{"responders":[{"id":"toString","name":null}],"state":"list"}');
  });

  it("tells an empty list, an absent file and an unreadable file apart", () => {
    expect(renderResponderList({ names: {}, whitelist: { identities: [], kind: "list" } })).toEqual({
      responders: [],
      state: "empty",
    });
    expect(renderResponderList({ names: {}, whitelist: { kind: "absent" } })).toEqual({
      responders: [],
      state: "absent",
      why: "responders.json is absent under $SLOPWEAVER_HOME",
    });
    expect(renderResponderList({ names: {}, whitelist: { kind: "unreadable", why: "not JSON" } })).toEqual({
      responders: [],
      state: "unreadable",
      why: "not JSON",
    });
  });
});

describe("responderListLines", () => {
  it("prints a count line, then one line per person with their id and name", () => {
    const lines = responderListLines({
      listing: {
        responders: [
          { id: "U0SYNAAA", name: "Ari" },
          { id: "U0SYNBBB", name: null },
        ],
        state: "list",
      },
    });
    expect(lines).toEqual([
      "2 people are on the responder whitelist:",
      "  U0SYNAAA  Ari",
      "  U0SYNBBB  (no Slack member row)",
    ]);
  });

  it("says one person in the singular", () => {
    const lines = responderListLines({ listing: { responders: [{ id: "U0SYNAAA", name: "Ari" }], state: "list" } });
    expect(lines[0]).toBe("1 person is on the responder whitelist:");
  });

  it("says the whitelist admits nobody when the gate is closed, naming why", () => {
    expect(responderListLines({ listing: { responders: [], state: "empty" } })).toEqual([
      "responders.json is EMPTY — the responder whitelist admits nobody",
    ]);
    expect(responderListLines({ listing: { responders: [], state: "absent" } })).toEqual([
      "responders.json is ABSENT — the responder whitelist admits nobody",
    ]);
    expect(responderListLines({ listing: { responders: [], state: "unreadable", why: "not JSON" } })).toEqual([
      "responders.json is UNREADABLE (not JSON) — the responder whitelist admits nobody",
    ]);
  });
});

describe("parseRespondersListArgs", () => {
  it("accepts --json and --home and refuses anything else", () => {
    expect(unwrap(parseRespondersListArgs({ rest: ["--json", "--home", "/x"] })).values).toEqual({
      home: "/x",
      json: true,
    });
    expect(unwrapErr(parseRespondersListArgs({ rest: ["--user", "U0X"] }))).toEqual([
      "unknown flag: --user",
      "unexpected argument: U0X",
    ]);
  });
});

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-responders-list-"));
  fixtureDirs.push(dir);
  return dir;
}

function member({ nativeId, name }: { nativeId: string; name: string }): MemberBronzeRow {
  return {
    fetchedAtIso: "2026-11-01T00:00:00.000Z",
    identity: buildMemberIdentity({ handle: nativeId.toLowerCase(), name, nativeId, source: "slack" }),
    profile: {},
    provenance: [],
    raw: {},
    source: "slack",
    sourceId: nativeId,
    version: 1,
    warnings: [],
  };
}

describe("runRespondersList", () => {
  it("exits 0 on a home whose list holds people, and the names it prints come from that home's member rows", () => {
    const home = tempHome();
    runRespondersAdd([
      "node",
      "slopweaver",
      "responders",
      "add",
      "--user",
      "U0SYNAAA",
      "--reason",
      "n/a",
      "--home",
      home,
    ]);
    unwrap(
      writeMemberRows({
        home,
        protection: NO_PROTECTION,
        rows: [member({ name: "Ari", nativeId: "U0SYNAAA" })],
        source: "slack",
      }),
    );

    expect(runRespondersList(["node", "slopweaver", "responders", "list", "--home", home])).toBe(EXIT_OK);
    expect(slackMemberNames({ home })).toEqual({ names: { U0SYNAAA: "Ari" }, warnings: [] });
  });

  it("names a member whose id is spelled `__proto__`, stored as an own key rather than as the prototype", () => {
    const home = tempHome();
    unwrap(
      writeMemberRows({
        home,
        protection: NO_PROTECTION,
        rows: [member({ name: "Proto", nativeId: "__proto__" })],
        source: "slack",
      }),
    );
    const listing = renderResponderList({
      names: slackMemberNames({ home }).names,
      whitelist: { identities: ["__proto__"], kind: "list" },
    });
    expect(listing.responders).toEqual([{ id: "__proto__", name: "Proto" }]);
  });

  it("exits 3 when the file is absent or the list is empty — a closed gate is a status, not a fault", () => {
    const absent = tempHome();
    expect(runRespondersList(["node", "slopweaver", "responders", "list", "--home", absent])).toBe(EXIT_EXPECTED_EMPTY);

    const empty = tempHome();
    writeFileSync(stateHomePaths({ home: empty }).respondersJson, "[]");
    expect(runRespondersList(["node", "slopweaver", "responders", "list", "--home", empty, "--json"])).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });

  it("exits 1 when the file exists and is not JSON", () => {
    const home = tempHome();
    writeFileSync(stateHomePaths({ home }).respondersJson, "{not json");
    expect(runRespondersList(["node", "slopweaver", "responders", "list", "--home", home])).toBe(EXIT_ERROR);
  });

  it("refuses an unknown flag with a usage code before reading anything", () => {
    expect(runRespondersList(["node", "slopweaver", "responders", "list", "--user", "U0X"])).toBe(EXIT_USAGE);
  });
});

describe("responders list manifest", () => {
  it("declares list as writing nothing and door-free, and lazily loads the command this module exports", () => {
    expect(respondersManifest["list"]!.meta.effect).toBe("none");
    expect(respondersManifest["list"]!.meta.doorRouted).toBe(false);
    expect(respondersListCommand).toBe(runRespondersList);
  });
});
