/**
 * `slopweaver responders add|remove` — the one real write path for `responders.json`. Local state only,
 * so every case here is a real temp-home round trip rather than an injected fake.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseRespondersArgs,
  respondersAddCommand,
  respondersRemoveCommand,
  runRespondersAdd,
  runRespondersRemove,
} from "../../../../../cli/commands/responders/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { respondersManifest } from "../../../../../cli/manifests/responders.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { loadResponderWhitelist } from "../../../../../live/listen/whitelistStore.js";

describe("parseRespondersArgs", () => {
  it("does not mistake its own verb token for a stray argument", () => {
    const argv = ["node", "slopweaver", "responders", "add", "--user", "U0NEW", "--reason", "x"];
    const parsed = parseRespondersArgs({ rest: argv.slice(4) });

    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.positionals : ["not parsed"]).toEqual([]);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(unwrapErr(parseRespondersArgs({ rest: ["--not-a-flag", "x"] }))).toEqual([
      "unknown flag: --not-a-flag",
      "unexpected argument: x",
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
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-responders-cli-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("runRespondersAdd", () => {
  it("refuses with a usage code when every required flag is absent, before any effect", () => {
    const home = tempHome();
    expect(runRespondersAdd(["node", "slopweaver", "responders", "add", "--home", home])).toBe(EXIT_USAGE);
    expect(loadResponderWhitelist({ home })).toEqual({ kind: "absent" });
  });

  it("refuses with a usage code when --reason is missing", () => {
    const home = tempHome();
    const code = runRespondersAdd(["node", "slopweaver", "responders", "add", "--user", "U0NEW", "--home", home]);
    expect(code).toBe(EXIT_USAGE);
    expect(loadResponderWhitelist({ home })).toEqual({ kind: "absent" });
  });

  it("adds a real id an entrance check can read straight back", () => {
    const home = tempHome();
    const code = runRespondersAdd([
      "node",
      "slopweaver",
      "responders",
      "add",
      "--user",
      "U0NEW",
      "--reason",
      "owner asked live in Slack",
      "--home",
      home,
    ]);

    expect(code).toBe(EXIT_OK);
    expect(loadResponderWhitelist({ home })).toEqual({ identities: ["U0NEW"], kind: "list" });
  });

  it("is idempotent — repeating the same add does not duplicate the entry", () => {
    const home = tempHome();
    const argv = ["node", "slopweaver", "responders", "add", "--user", "U0NEW", "--reason", "n/a", "--home", home];
    runRespondersAdd(argv);
    const code = runRespondersAdd(argv);
    expect(code).toBe(EXIT_OK);
    expect(loadResponderWhitelist({ home })).toEqual({ identities: ["U0NEW"], kind: "list" });
  });
});

describe("runRespondersRemove", () => {
  it("removes a real id, so a later admission check refuses it", () => {
    const home = tempHome();
    runRespondersAdd(["node", "slopweaver", "responders", "add", "--user", "U0NEW", "--reason", "n/a", "--home", home]);

    const code = runRespondersRemove([
      "node",
      "slopweaver",
      "responders",
      "remove",
      "--user",
      "U0NEW",
      "--reason",
      "no longer needed",
      "--home",
      home,
    ]);

    expect(code).toBe(EXIT_OK);
    expect(loadResponderWhitelist({ home })).toEqual({ identities: [], kind: "list" });
  });
});

describe("responders manifest", () => {
  it("declares add and remove as local-state and door-free — never an external write", () => {
    expect(respondersManifest["add"]!.meta.effect).toBe("local-state");
    expect(respondersManifest["add"]!.meta.doorRouted).toBe(false);
    expect(respondersManifest["remove"]!.meta.effect).toBe("local-state");
    expect(respondersManifest["remove"]!.meta.doorRouted).toBe(false);
  });

  it("exposes the commands the manifest lazily loads", () => {
    expect(respondersAddCommand).toBe(runRespondersAdd);
    expect(respondersRemoveCommand).toBe(runRespondersRemove);
  });
});
