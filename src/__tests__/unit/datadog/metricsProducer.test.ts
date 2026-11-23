/**
 * The pure half of a metrics producer: which declaration a name resolves to, the argv tail it is launched with, and
 * what its stdout is read as — the LAST non-empty line, one series document, refused rather than guessed at.
 */
import { describe, expect, it } from "vitest";

import {
  MetricsProducerErrors,
  metricsProducerFromProfile,
  parseMetricsProducerOutput,
  producerArgs,
} from "../../../datadog/metricsProducer.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { type Profile, parseProfile } from "../../../profile.js";
import type { MetricsProducerConfig } from "../../../profileProviders.js";

const CONFIG: MetricsProducerConfig = {
  checkout: "/work/acme-metrics",
  command: ["node", "produce.js", "--team", "all"],
  secrets: {},
};

/** A profile declaring exactly the producers given. */
function profileWith({ producers }: { readonly producers: Record<string, unknown> }): Profile {
  return unwrap(
    parseProfile({
      value: {
        datadog: { metricsProducers: producers },
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        sources: [],
      },
    }),
  );
}

/** A UTC midnight, the day every case here asks for. Repro: `slopweaver slack when 1789516800`. */
const DAY_START = 1_789_516_800;
const DAY = "2026-09-16";

/** One gauge document with a single point at `stamp`. */
function gaugeLine({ stamp }: { readonly stamp: number }): string {
  return `{"series":[{"metric":"acme.delivery.open","points":[[${String(stamp)},4]],"type":"gauge"}]}`;
}

const GAUGE_LINE = gaugeLine({ stamp: DAY_START });

describe("metricsProducerFromProfile", () => {
  it("resolves a declared name to its parsed declaration", () => {
    const profile = profileWith({ producers: { "daily-delivery": { checkout: CONFIG.checkout, command: ["node"] } } });
    expect(unwrap(metricsProducerFromProfile({ producer: "daily-delivery", profile }))).toEqual({
      checkout: "/work/acme-metrics",
      command: ["node"],
      secrets: {},
    });
  });

  it("refuses a name the profile does not declare, and a home with no profile, the same way", () => {
    const expected = MetricsProducerErrors.notDeclared({ producer: "daily-delivery" });
    expect(
      unwrapErr(metricsProducerFromProfile({ producer: "daily-delivery", profile: profileWith({ producers: {} }) })),
    ).toEqual(expected);
    expect(unwrapErr(metricsProducerFromProfile({ producer: "daily-delivery", profile: null }))).toEqual(expected);
  });

  it("never resolves an inherited property name as a producer", () => {
    const error = unwrapErr(
      metricsProducerFromProfile({ producer: "constructor", profile: profileWith({ producers: {} }) }),
    );
    expect(error.code).toBe("PRODUCER_NOT_DECLARED");
  });
});

describe("producerArgs", () => {
  it("is the declared command after the executable, then --day", () => {
    expect(producerArgs({ config: CONFIG, day: "2026-09-16" })).toEqual([
      "produce.js",
      "--team",
      "all",
      "--day",
      "2026-09-16",
    ]);
  });

  it("is only --day when the command is a bare executable", () => {
    expect(
      producerArgs({ config: { ...CONFIG, command: ["/usr/local/bin/acme-produce"] }, day: "2026-09-16" }),
    ).toEqual(["--day", "2026-09-16"]);
  });
});

describe("parseMetricsProducerOutput", () => {
  it("reads the last non-empty line, so progress may precede it", () => {
    const stdout = `fetching merged pull requests…\n42 found\n${GAUGE_LINE}\n\n`;
    expect(unwrap(parseMetricsProducerOutput({ day: DAY, producer: "daily-delivery", stdout }))).toEqual([
      { metric: "acme.delivery.open", points: [[DAY_START, 4]], tags: [], type: "gauge" },
    ]);
  });

  it("accepts a point at the day's last second", () => {
    const stdout = gaugeLine({ stamp: DAY_START + 86_399 });
    expect(unwrap(parseMetricsProducerOutput({ day: DAY, producer: "daily-delivery", stdout }))).toHaveLength(1);
  });

  it("refuses a point on the next day's midnight, naming the metric, the stamp and the day", () => {
    const stdout = gaugeLine({ stamp: DAY_START + 86_400 });
    expect(unwrapErr(parseMetricsProducerOutput({ day: DAY, producer: "daily-delivery", stdout }))).toEqual(
      MetricsProducerErrors.outputInvalid({
        producer: "daily-delivery",
        why: "acme.delivery.open has a point at epoch 1789603200, outside 2026-09-16 UTC — it was asked for that day only",
      }),
    );
  });

  it("refuses a producer that ignored --day and printed the previous day", () => {
    const stdout = gaugeLine({ stamp: DAY_START - 1 });
    expect(unwrapErr(parseMetricsProducerOutput({ day: DAY, producer: "daily-delivery", stdout })).code).toBe(
      "PRODUCER_OUTPUT_INVALID",
    );
  });

  it("refuses empty stdout by saying nothing was printed", () => {
    expect(unwrapErr(parseMetricsProducerOutput({ day: DAY, producer: "daily-delivery", stdout: "\n  \n" }))).toEqual(
      MetricsProducerErrors.outputInvalid({ producer: "daily-delivery", why: "it printed nothing" }),
    );
  });

  it("refuses a last line that is progress rather than a document", () => {
    const error = unwrapErr(
      parseMetricsProducerOutput({ day: DAY, producer: "daily-delivery", stdout: `${GAUGE_LINE}\ndone\n` }),
    );
    expect(error.code).toBe("PRODUCER_OUTPUT_INVALID");
    expect(error.message).toContain("producer 'daily-delivery' printed no usable series document");
  });

  it("refuses a document pretty-printed across lines, which is outside the contract", () => {
    const stdout = '{\n  "series": [\n    {"metric":"acme.delivery.open","points":[[1,4]],"type":"gauge"}\n  ]\n}\n';
    expect(unwrapErr(parseMetricsProducerOutput({ day: DAY, producer: "daily-delivery", stdout })).code).toBe(
      "PRODUCER_OUTPUT_INVALID",
    );
  });
});
