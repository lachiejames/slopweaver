import { describe, expect, it } from "vitest";

import {
  datadogApmCommand,
  datadogCiCommand,
  datadogDbmCommand,
  datadogLogsCommand,
  datadogProfilesCommand,
  datadogRumCommand,
  datadogTestsCommand,
} from "../../../../cli/commands/datadog/investigateRun.js";
import { datadogManifest } from "../../../../cli/manifests/datadog.js";
import { datadogInvestigateManifest } from "../../../../cli/manifests/datadogInvestigate.js";

const EXPECTED = [
  ["logs", datadogLogsCommand],
  ["apm", datadogApmCommand],
  ["rum", datadogRumCommand],
  ["ci", datadogCiCommand],
  ["tests", datadogTestsCommand],
  ["dbm", datadogDbmCommand],
  ["profiles", datadogProfilesCommand],
] as const;

describe("the datadog investigate manifest part", () => {
  it("holds exactly the seven investigate verbs, in order", () => {
    expect(Object.keys(datadogInvestigateManifest)).toEqual(EXPECTED.map(([verb]) => verb));
  });

  it("is spread into the datadog noun as undoored external reads", () => {
    const misplaced = EXPECTED.filter(([verb]) => datadogManifest[verb] !== datadogInvestigateManifest[verb]);
    const writes = EXPECTED.filter(([verb]) => {
      const meta = datadogInvestigateManifest[verb]!.meta;
      return meta.effect !== "external-read" || meta.doorRouted;
    });
    expect(misplaced).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("loads each verb's own command from the investigate runner", async () => {
    const loaded = await Promise.all(EXPECTED.map(([verb]) => datadogInvestigateManifest[verb]!.load()));
    expect(loaded).toEqual(EXPECTED.map(([, command]) => command));
  });
});
