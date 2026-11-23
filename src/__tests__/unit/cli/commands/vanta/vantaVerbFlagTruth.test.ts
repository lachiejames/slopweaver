import { describe, expect, it } from "vitest";

import {
  parseVantaControlEvidenceOptions,
  parseVantaControlsEvidenceOptions,
  VANTA_CONTROL_EVIDENCE_FLAG_NAMES,
} from "../../../../../cli/commands/vanta/controlEvidenceCore.js";
import { VANTA_CONTROL_EVIDENCE_USAGE } from "../../../../../cli/commands/vanta/controlEvidenceRun.js";
import { VANTA_CONTROLS_EVIDENCE_USAGE } from "../../../../../cli/commands/vanta/controlsEvidenceRun.js";
import { VANTA_DEACTIVATE_USAGE } from "../../../../../cli/commands/vanta/deactivateRun.js";
import {
  parseVantaCreateDocumentOptions,
  parseVantaSubmitDocumentOptions,
  parseVantaUploadEvidenceOptions,
  VANTA_DOCUMENT_FLAG_NAMES,
} from "../../../../../cli/commands/vanta/documentCore.js";
import { mediaTypeFor } from "../../../../../cli/commands/vanta/documentRun.js";
import {
  VANTA_CREATE_DOCUMENT_USAGE,
  VANTA_SUBMIT_DOCUMENT_USAGE,
  VANTA_UPLOAD_EVIDENCE_USAGE,
} from "../../../../../cli/commands/vanta/documentUsage.js";
import {
  parseVantaGroupPeopleOptions,
  VANTA_GROUP_PEOPLE_FLAG_NAMES,
  VANTA_GROUP_PEOPLE_USAGE,
} from "../../../../../cli/commands/vanta/groupPeopleCore.js";
import { parseVantaReactivateOptions } from "../../../../../cli/commands/vanta/reactivateCore.js";
import { VANTA_REACTIVATE_USAGE } from "../../../../../cli/commands/vanta/reactivateRun.js";
import { VANTA_RESET_USAGE } from "../../../../../cli/commands/vanta/resetRun.js";
import { VANTA_SYNC_USAGE } from "../../../../../cli/commands/vanta/syncRun.js";
import {
  parseVantaTestEntitiesOptions,
  VANTA_TEST_ENTITIES_FLAG_NAMES,
} from "../../../../../cli/commands/vanta/testEntitiesCore.js";
import { VANTA_TEST_ENTITIES_USAGE } from "../../../../../cli/commands/vanta/testEntitiesRun.js";
import { VANTA_VULNERABILITIES_USAGE } from "../../../../../cli/commands/vanta/vulnerabilitiesRun.js";
import {
  parseVantaDeactivateOptions,
  parseVantaVulnerabilitiesOptions,
  VANTA_VULNERABILITY_FLAG_NAMES,
} from "../../../../../cli/commands/vanta/vulnerabilityCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/**
 * Vanta's verbs are reached THROUGH a platform now — `atlas vanta sync`, `write vanta deactivate` — so they
 * hold no manifest row of their own and `helpTruth.test.ts`'s ratchet cannot see them. That ratchet is what
 * stopped a real, shipped flag being invisible for a month, so its property is asserted here rather than
 * quietly lost with the rows that used to carry it.
 */
const USAGE_BY_VERB: Readonly<Record<string, string>> = {
  "control-evidence": VANTA_CONTROL_EVIDENCE_USAGE,
  "controls-evidence": VANTA_CONTROLS_EVIDENCE_USAGE,
  "create-document": VANTA_CREATE_DOCUMENT_USAGE,
  deactivate: VANTA_DEACTIVATE_USAGE,
  "group-people": VANTA_GROUP_PEOPLE_USAGE,
  reactivate: VANTA_REACTIVATE_USAGE,
  "submit-document": VANTA_SUBMIT_DOCUMENT_USAGE,
  "test-entities": VANTA_TEST_ENTITIES_USAGE,
  "upload-evidence": VANTA_UPLOAD_EVIDENCE_USAGE,
  vulnerabilities: VANTA_VULNERABILITIES_USAGE,
};

/** Every verb's declared flag names, from whichever core file owns that verb's parser. */
const FLAG_NAMES_BY_VERB: Readonly<Record<string, readonly string[]>> = {
  ...VANTA_VULNERABILITY_FLAG_NAMES,
  ...VANTA_CONTROL_EVIDENCE_FLAG_NAMES,
  ...VANTA_DOCUMENT_FLAG_NAMES,
  "group-people": VANTA_GROUP_PEOPLE_FLAG_NAMES,
  "test-entities": VANTA_TEST_ENTITIES_FLAG_NAMES,
};

/**
 * One verb's declared flag names, refusing a verb no core file declares: an absent entry used to read as "no
 * flags", so a verb dropped from {@link FLAG_NAMES_BY_VERB} passed both truth checks below vacuously.
 */
function declaredFlagNames({ verb }: { verb: string }): readonly string[] {
  const names = FLAG_NAMES_BY_VERB[verb];
  if (names === undefined) {
    throw new Error(`no core file declares the flag names of vanta ${verb}`);
  }
  return names;
}

/**
 * Prepend a verb's one required flag unless the probe is that flag — a second `--ids` is a refusal by
 * design, and a second `--status` would test the parser's last-one-wins rather than the flag.
 */
function withRequired({
  flag,
  value,
  parse,
}: {
  flag: string;
  value: string;
  parse: (input: { rest: readonly string[]; defaultHome: string }) => { isErr: () => boolean };
}): ParserProbe["parse"] {
  return ({ rest, defaultHome }) => parse({ defaultHome, rest: rest.includes(flag) ? rest : [flag, value, ...rest] });
}

/**
 * `deactivate` demands a batch — `--ids` plus a `--reason`, or a `--form` carrying both — so probing any
 * OTHER flag needs one supplied. Probing `--ids`, `--reason` or `--form` must NOT have one added: a repeated
 * `--ids` is a refusal by design, because a silently-dropped id would be a silent scope change on a
 * compliance write, and `--form` alongside `--ids` is the two-spellings clash.
 */
function deactivateBatch({ fragment }: { fragment: readonly string[] }): readonly string[] {
  if (fragment.includes("--form")) {
    return [...fragment];
  }
  if (fragment.includes("--ids")) {
    return [...fragment, "--reason", "r"];
  }
  if (fragment.includes("--reason")) {
    return ["--ids", "vuln-1", ...fragment];
  }
  return ["--ids", "vuln-1", "--reason", "r", ...fragment];
}

/** One verb's parser, the tail it demands before any probe, and a value for each flag that takes one. */
interface ParserProbe {
  readonly parse: (input: { rest: readonly string[]; defaultHome: string }) => { isErr: () => boolean };
  readonly required: readonly string[];
  readonly values: Readonly<Record<string, string>>;
}

/** The credential-file pair every Vanta verb accepts, and the home flag — spelled once. */
const SHARED_VALUES: Readonly<Record<string, string>> = {
  "--client-id-file": "/id",
  "--client-secret-file": "/secret",
  "--home": "/home",
};

/** Every verb whose parser this file probes directly, and what each one needs to get that far. */
const PARSER_PROBES: Readonly<Record<string, ParserProbe>> = {
  "control-evidence": {
    parse: parseVantaControlEvidenceOptions,
    required: ["--control", "c1"],
    values: {
      ...SHARED_VALUES,
      "--artifact": "/tmp/e.json",
      "--control": "c1",
      "--entity-sample": "3",
      "--tenant": "t",
    },
  },
  "controls-evidence": {
    parse: parseVantaControlsEvidenceOptions,
    required: [],
    values: { ...SHARED_VALUES, "--artifact": "/tmp/e.json", "--tenant": "t" },
  },
  "create-document": {
    parse: parseVantaCreateDocumentOptions,
    required: ["--title", "t", "--description", "d"],
    values: {
      ...SHARED_VALUES,
      "--approve": "abc123",
      "--cadence": "P1Y",
      "--description": "d",
      "--reminder-window": "P1M",
      "--time-sensitivity": "MOST_RECENT",
      "--title": "t",
    },
  },
  "group-people": {
    parse: parseVantaGroupPeopleOptions,
    required: ["--group", "g1"],
    values: { ...SHARED_VALUES, "--add": "p1", "--approve": "abc123", "--group": "g1", "--remove": "p2" },
  },
  reactivate: {
    parse: withRequired({ flag: "--ids", parse: parseVantaReactivateOptions, value: "vuln-1" }),
    required: [],
    values: { ...SHARED_VALUES, "--approve": "abc123", "--ids": "vuln-1" },
  },
  "submit-document": {
    parse: parseVantaSubmitDocumentOptions,
    required: ["--document", "d1"],
    values: { ...SHARED_VALUES, "--approve": "abc123", "--document": "d1" },
  },
  "test-entities": {
    parse: withRequired({ flag: "--status", parse: parseVantaTestEntitiesOptions, value: "DEACTIVATED" }),
    required: [],
    values: { ...SHARED_VALUES, "--limit": "5", "--status": "FAILING", "--test": "t1" },
  },
  "upload-evidence": {
    parse: parseVantaUploadEvidenceOptions,
    required: ["--document", "d1", "--file", "/tmp/f"],
    values: {
      ...SHARED_VALUES,
      "--approve": "abc123",
      "--description": "Q1",
      "--document": "d1",
      "--effective-at": "2026-01-01",
      "--file": "/tmp/f",
    },
  },
};

/** The value tokens one probed flag carries — empty for a boolean flag, which takes none. */
function valueFor({ flag, probe }: { flag: string; probe: ParserProbe }): readonly string[] {
  const value = probe.values[flag];
  return value === undefined ? [] : [value];
}

/**
 * The argv one probed flag is pushed through: the verb's required flags, plus the probed one unless the
 * required set already carries it — the parser refuses a value flag given twice.
 */
function withProbedFlag({ flag, probe }: { flag: string; probe: ParserProbe }): readonly string[] {
  if (probe.required.includes(flag)) {
    return probe.required;
  }
  return [...probe.required, flag, ...valueFor({ flag, probe })];
}

describe("every Vanta verb advertises the flags its parser accepts", () => {
  it("names each flag in the usage the verb prints", () => {
    const unadvertised = Object.entries(USAGE_BY_VERB).flatMap(([verb, usage]) =>
      declaredFlagNames({ verb })
        .filter((flag) => !usage.includes(flag))
        .map((flag) => `${verb} ${flag}`),
    );

    expect(unadvertised).toEqual([]);
  });

  it("addresses each verb through its platform, never through a noun of its own", () => {
    expect(VANTA_SYNC_USAGE.startsWith("usage: slopweaver atlas vanta sync")).toBe(true);
    expect(VANTA_RESET_USAGE.startsWith("usage: slopweaver atlas vanta reset")).toBe(true);
    expect(VANTA_VULNERABILITIES_USAGE.startsWith("usage: slopweaver atlas vanta vulnerabilities")).toBe(true);
    expect(VANTA_DEACTIVATE_USAGE.startsWith("usage: slopweaver write vanta deactivate")).toBe(true);
    expect(VANTA_REACTIVATE_USAGE.startsWith("usage: slopweaver write vanta reactivate")).toBe(true);
    expect(VANTA_TEST_ENTITIES_USAGE.startsWith("usage: slopweaver atlas vanta test-entities")).toBe(true);
    expect(VANTA_CONTROLS_EVIDENCE_USAGE.startsWith("usage: slopweaver atlas vanta controls-evidence")).toBe(true);
    expect(VANTA_CONTROL_EVIDENCE_USAGE.startsWith("usage: slopweaver atlas vanta control-evidence")).toBe(true);
    expect(VANTA_CREATE_DOCUMENT_USAGE.startsWith("usage: slopweaver write vanta create-document")).toBe(true);
    expect(VANTA_UPLOAD_EVIDENCE_USAGE.startsWith("usage: slopweaver write vanta upload-evidence")).toBe(true);
    expect(VANTA_SUBMIT_DOCUMENT_USAGE.startsWith("usage: slopweaver write vanta submit-document")).toBe(true);
    expect(VANTA_GROUP_PEOPLE_USAGE.startsWith("usage: slopweaver write vanta group-people")).toBe(true);
  });

  it("says the upload approval binds the file's SHA-256, so a reader knows a swapped file stops matching", () => {
    expect(VANTA_UPLOAD_EVIDENCE_USAGE).toContain("covers that exact request and the file's SHA-256");
  });

  // Declarations are not behaviour: every advertised flag is pushed through the REAL parser, and a flag the
  // parser does not accept fails here rather than being invisible until someone types it. A valued flag
  // carries a value its own verb would accept — a generic placeholder would fail an enum or an integer and
  // report a parser defect that is really the probe's.
  it("accepts each advertised flag through the real parser", () => {
    const rejected = Object.entries(PARSER_PROBES).flatMap(([verb, probe]) =>
      declaredFlagNames({ verb })
        .map((flag) => ({ flag, rest: withProbedFlag({ flag, probe }) }))
        .filter(({ rest }) => probe.parse({ defaultHome: "/home", rest }).isErr())
        .map(({ flag }) => `${verb} ${flag}`),
    );

    expect(rejected).toEqual([]);
  });

  it("refuses a flag no verb declares, so the probe above cannot pass vacuously", () => {
    const result = parseVantaControlsEvidenceOptions({ defaultHome: "/home", rest: ["--not-a-flag"] });

    expect(unwrapErr(result)).toEqual(["unknown flag: --not-a-flag"]);
  });

  // The parsers are unchanged by the move, and this is what proves it: the mutation verb still accepts the
  // flags its usage advertises, reached through the batch shape a compliance write demands.
  it("still parses the mutation verb's flags through its required batch", () => {
    const parsed = unwrap(
      parseVantaDeactivateOptions({ defaultHome: "/tmp", rest: deactivateBatch({ fragment: ["--json"] }) }),
    );
    expect(parsed.base.json).toBe(true);
    expect(parsed.source.kind).toBe("flags");
  });

  it("still parses the live read's own filters", () => {
    const parsed = unwrap(
      parseVantaVulnerabilitiesOptions({ defaultHome: "/tmp", rest: ["--severity", "CRITICAL", "--json"] }),
    );
    expect(parsed.json).toBe(true);
  });
});

describe("mediaTypeFor", () => {
  it("names the media type the upload table declares for an extension", () => {
    expect(mediaTypeFor({ extension: ".pdf" })).toBe("application/pdf");
  });

  it("announces an extension the table declares nothing for as an opaque stream", () => {
    expect(mediaTypeFor({ extension: ".xyz" })).toBe("application/octet-stream");
  });

  it("never lets an inherited key answer for a declared one", () => {
    expect(mediaTypeFor({ extension: "constructor" })).toBe("application/octet-stream");
  });
});
