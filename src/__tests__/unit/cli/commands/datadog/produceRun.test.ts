/**
 * `datadog produce`'s decision path — declaration, environment, launch, parse — through `produceDay`'s two seams,
 * and the exit code each refusal earns. No process is launched and no secret file is read.
 */
import { describe, expect, it } from "vitest";

import { produceDay, produceExitCode } from "../../../../../cli/commands/datadog/produceRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../../../../cli/exitCodes.js";
import { MetricsProducerErrors } from "../../../../../datadog/metricsProducer.js";
import type { ProducerCommand } from "../../../../../datadog/metricsProducerRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { type Profile, parseProfile } from "../../../../../profile.js";
import { ProfileReadErrors } from "../../../../../profileStore.js";

const PROFILE: Profile = unwrap(
  parseProfile({
    value: {
      datadog: {
        metricsProducers: {
          "daily-delivery": {
            checkout: "/work/acme-metrics",
            command: ["node", "produce.js"],
            secrets: { ACME_TOKEN: "github-token" },
          },
        },
      },
      displayName: "",
      gitNamespace: "",
      id: "me",
      schemaVersion: 1,
      sources: [],
    },
  }),
);

/** The instant 1789516800 names, inside the day every case asks for. Repro: `slopweaver slack when 1789516800`. */
const DOCUMENT = '{"series":[{"metric":"acme.delivery.open","points":[[1789516800,4]],"type":"gauge"}]}';

describe("produceDay", () => {
  it("runs the declared producer with its secret and returns what it printed", () => {
    const calls: Parameters<ProducerCommand>[0][] = [];
    const series = unwrap(
      produceDay({
        day: "2026-09-16",
        home: "/state/home",
        parentEnv: { PATH: "/usr/bin" },
        producer: "daily-delivery",
        profile: PROFILE,
        readSecret: () => "FIXTURE-token",
        runCommand: (input) => {
          calls.push(input);
          return `working…\n${DOCUMENT}\n`;
        },
      }),
    );
    expect(series).toEqual([{ metric: "acme.delivery.open", points: [[1_789_516_800, 4]], tags: [], type: "gauge" }]);
    expect(calls).toEqual([
      {
        args: ["produce.js", "--day", "2026-09-16"],
        command: "node",
        cwd: "/work/acme-metrics",
        env: { ACME_TOKEN: "FIXTURE-token", PATH: "/usr/bin", SLOPWEAVER_HOME: "/state/home" },
      },
    ]);
  });

  it("launches nothing for an undeclared producer", () => {
    const calls: string[] = [];
    const error = unwrapErr(
      produceDay({
        day: "2026-09-16",
        home: "/state/home",
        parentEnv: {},
        producer: "weekly-delivery",
        profile: PROFILE,
        readSecret: () => "FIXTURE-token",
        runCommand: ({ command }) => {
          calls.push(command);
          return DOCUMENT;
        },
      }),
    );
    expect(error).toEqual(MetricsProducerErrors.notDeclared({ producer: "weekly-delivery" }));
    expect(calls).toEqual([]);
  });

  it("launches nothing when a declared secret is not stored", () => {
    const calls: string[] = [];
    const error = unwrapErr(
      produceDay({
        day: "2026-09-16",
        home: "/state/home",
        parentEnv: {},
        producer: "daily-delivery",
        profile: PROFILE,
        readSecret: () => undefined,
        runCommand: ({ command }) => {
          calls.push(command);
          return DOCUMENT;
        },
      }),
    );
    expect(error.code).toBe("PRODUCER_SECRET_ABSENT");
    expect(calls).toEqual([]);
  });

  it("refuses output that is not a series document", () => {
    const error = unwrapErr(
      produceDay({
        day: "2026-09-16",
        home: "/state/home",
        parentEnv: {},
        producer: "daily-delivery",
        profile: PROFILE,
        readSecret: () => "FIXTURE-token",
        runCommand: () => "no document here\n",
      }),
    );
    expect(error.code).toBe("PRODUCER_OUTPUT_INVALID");
  });
});

describe("produceExitCode", () => {
  it.each([
    [MetricsProducerErrors.notDeclared({ producer: "daily-delivery" }), EXIT_EXPECTED_EMPTY],
    [
      MetricsProducerErrors.secretAbsent({ producer: "daily-delivery", secretName: "github-token" }),
      EXIT_EXPECTED_EMPTY,
    ],
    [
      MetricsProducerErrors.profileUnreadable({
        error: ProfileReadErrors.unreadable({ detail: "unexpected token", path: "/state/home/profile.json" }),
      }),
      EXIT_ERROR,
    ],
    [MetricsProducerErrors.secretUnregistered({ producer: "daily-delivery", secretName: "acme-token" }), EXIT_ERROR],
    [MetricsProducerErrors.secretReservedName({ envName: "SLOPWEAVER_HOME", producer: "daily-delivery" }), EXIT_ERROR],
    [MetricsProducerErrors.runFailed({ ending: "exited 1", producer: "daily-delivery", stderrTail: [] }), EXIT_ERROR],
    [MetricsProducerErrors.outputInvalid({ producer: "daily-delivery", why: "it printed nothing" }), EXIT_ERROR],
  ])("maps $code to its exit code", (error, code) => {
    expect(produceExitCode({ error })).toBe(code);
  });
});
