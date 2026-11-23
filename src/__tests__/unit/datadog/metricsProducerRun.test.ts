/**
 * The metrics producer launcher, driven through its two plain seams: the environment the child is handed (the
 * baseline and its declared secrets, nothing else of the parent's) and how a run's ending becomes a typed refusal.
 * A seam is a function passed in that records what it got — no mock, and no process is launched.
 */
import { describe, expect, it } from "vitest";

import { CALLER_GATE_HOMES_ENV } from "../../../cli/callerGateHomesEnv.js";
import { MetricsProducerErrors } from "../../../datadog/metricsProducer.js";
import {
  type ProducerCommand,
  type ProducerSecretReader,
  producerEnvironment,
  runMetricsProducer,
} from "../../../datadog/metricsProducerRun.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { MetricsProducerConfig } from "../../../profileProviders.js";

const CONFIG: MetricsProducerConfig = {
  checkout: "/work/acme-metrics",
  command: ["node", "produce.js"],
  secrets: { ACME_TOKEN: "github-token" },
};

const PARENT_ENV: NodeJS.ProcessEnv = {
  AWS_SECRET_ACCESS_KEY: "FIXTURE-not-handed-on",
  HOME: "/Users/acme",
  PATH: "/usr/bin",
  TMPDIR: "/tmp/acme",
};

/** A secrets store holding exactly the entries given. */
function storeOf({ entries }: { readonly entries: Record<string, string> }): ProducerSecretReader {
  return ({ secretName }) => (Object.hasOwn(entries, secretName) ? entries[secretName] : undefined);
}

describe("producerEnvironment", () => {
  it("hands the child the baseline, the home and its declared secrets — nothing else of the parent's", () => {
    const env = unwrap(
      producerEnvironment({
        config: CONFIG,
        home: "/state/home",
        parentEnv: PARENT_ENV,
        producer: "daily-delivery",
        readSecret: storeOf({ entries: { "github-token": "FIXTURE-token" } }),
      }),
    );
    expect({ ...env }).toStrictEqual({
      ACME_TOKEN: "FIXTURE-token",
      HOME: "/Users/acme",
      PATH: "/usr/bin",
      SLOPWEAVER_HOME: "/state/home",
      TMPDIR: "/tmp/acme",
    });
  });

  it("hands on the caller gate homes a run-due tick set, so a ruling there still judges a slopweaver it spawns", () => {
    const env = unwrap(
      producerEnvironment({
        config: CONFIG,
        home: "/state/tick",
        parentEnv: { ...PARENT_ENV, [CALLER_GATE_HOMES_ENV]: '["/state/ambient","/state/tick"]' },
        producer: "daily-delivery",
        readSecret: storeOf({ entries: { "github-token": "FIXTURE-token" } }),
      }),
    );
    expect([env[CALLER_GATE_HOMES_ENV], env["AWS_SECRET_ACCESS_KEY"]]).toEqual([
      '["/state/ambient","/state/tick"]',
      undefined,
    ]);
  });

  it("omits a baseline variable the parent does not have, rather than handing on an empty one", () => {
    const env = unwrap(
      producerEnvironment({
        config: { ...CONFIG, secrets: {} },
        home: "/state/home",
        parentEnv: { PATH: "/usr/bin" },
        producer: "daily-delivery",
        readSecret: storeOf({ entries: {} }),
      }),
    );
    expect({ ...env }).toStrictEqual({ PATH: "/usr/bin", SLOPWEAVER_HOME: "/state/home" });
  });

  it("builds the environment with no prototype, so nothing inherited can reach the child's spawn", () => {
    const env = unwrap(
      producerEnvironment({
        config: { ...CONFIG, secrets: {} },
        home: "/state/home",
        parentEnv: { PATH: "/usr/bin" },
        producer: "daily-delivery",
        readSecret: storeOf({ entries: {} }),
      }),
    );
    expect(Object.getPrototypeOf(env)).toBe(null);
  });

  it("refuses before launch when a declared secret is not stored, naming the secret", () => {
    const error = unwrapErr(
      producerEnvironment({
        config: CONFIG,
        home: "/state/home",
        parentEnv: PARENT_ENV,
        producer: "daily-delivery",
        readSecret: storeOf({ entries: {} }),
      }),
    );
    expect(error).toEqual(
      MetricsProducerErrors.secretAbsent({ producer: "daily-delivery", secretName: "github-token" }),
    );
    expect(error.message).toContain("slopweaver secrets set github-token");
  });

  it("refuses before reading anything when a declared secret is not a name the register declares", () => {
    const reads: string[] = [];
    const error = unwrapErr(
      producerEnvironment({
        config: { ...CONFIG, secrets: { ACME_TOKEN: "acme-token" } },
        home: "/state/home",
        parentEnv: PARENT_ENV,
        producer: "daily-delivery",
        readSecret: ({ secretName }) => {
          reads.push(secretName);
          return "FIXTURE-token";
        },
      }),
    );
    expect(error).toEqual(
      MetricsProducerErrors.secretUnregistered({ producer: "daily-delivery", secretName: "acme-token" }),
    );
    expect(reads).toEqual([]);
  });

  it.each(["SLOPWEAVER_HOME", CALLER_GATE_HOMES_ENV])(
    "refuses before reading anything when a secret is mapped onto %s, which pins the child's home",
    (envName) => {
      const reads: string[] = [];
      const error = unwrapErr(
        producerEnvironment({
          config: { ...CONFIG, secrets: { [envName]: "github-token" } },
          home: "/state/tick",
          parentEnv: PARENT_ENV,
          producer: "daily-delivery",
          readSecret: ({ secretName }) => {
            reads.push(secretName);
            return "/state/ambient";
          },
        }),
      );
      expect(error).toEqual(MetricsProducerErrors.secretReservedName({ envName, producer: "daily-delivery" }));
      expect(reads).toEqual([]);
    },
  );

  it("reads each secret from the selected home", () => {
    const homes: string[] = [];
    producerEnvironment({
      config: CONFIG,
      home: "/state/home",
      parentEnv: PARENT_ENV,
      producer: "daily-delivery",
      readSecret: ({ home }) => {
        homes.push(home);
        return "FIXTURE-token";
      },
    });
    expect(homes).toEqual(["/state/home"]);
  });
});

/** A thrown `execFileSync`-shaped failure carrying the given fields. */
function thrownWith({ fields }: { readonly fields: Record<string, unknown> }): Error {
  return Object.assign(new Error("Command failed"), fields);
}

describe("runMetricsProducer", () => {
  it("launches the executable in the checkout with --day appended and the given environment, and returns stdout", () => {
    const calls: Parameters<ProducerCommand>[0][] = [];
    const stdout = unwrap(
      runMetricsProducer({
        config: CONFIG,
        day: "2026-09-16",
        env: { PATH: "/usr/bin" },
        producer: "daily-delivery",
        runCommand: (input) => {
          calls.push(input);
          return "the document\n";
        },
      }),
    );
    expect(stdout).toBe("the document\n");
    expect(calls).toEqual([
      {
        args: ["produce.js", "--day", "2026-09-16"],
        command: "node",
        cwd: "/work/acme-metrics",
        env: { PATH: "/usr/bin" },
      },
    ]);
  });

  it("reports a non-zero exit with the last twenty stderr lines", () => {
    const lines = Array.from({ length: 25 }, (_, index) => `line ${String(index + 1)}`);
    const stderr = `${lines.join("\n")}\n`;
    const error = unwrapErr(
      runMetricsProducer({
        config: CONFIG,
        day: "2026-09-16",
        env: {},
        producer: "daily-delivery",
        runCommand: () => {
          throw thrownWith({ fields: { signal: null, status: 2, stderr } });
        },
      }),
    );
    expect(error).toEqual(
      MetricsProducerErrors.runFailed({ ending: "exited 2", producer: "daily-delivery", stderrTail: lines.slice(5) }),
    );
    expect(error.message).toBe("producer 'daily-delivery' exited 2; nothing was written");
  });

  it("reports a kill by signal as a timeout or an interruption", () => {
    const error = unwrapErr(
      runMetricsProducer({
        config: CONFIG,
        day: "2026-09-16",
        env: {},
        producer: "daily-delivery",
        runCommand: () => {
          throw thrownWith({ fields: { signal: "SIGTERM", status: null, stderr: "" } });
        },
      }),
    );
    expect(error).toEqual(
      MetricsProducerErrors.runFailed({
        ending: "was killed by SIGTERM (it timed out, or was interrupted)",
        producer: "daily-delivery",
        stderrTail: [],
      }),
    );
  });

  it("reports a launch failure in words", () => {
    const error = unwrapErr(
      runMetricsProducer({
        config: CONFIG,
        day: "2026-09-16",
        env: {},
        producer: "daily-delivery",
        runCommand: () => {
          throw thrownWith({ fields: { code: "ENOENT" } });
        },
      }),
    );
    expect(error.message).toBe("producer 'daily-delivery' could not launch — Command failed; nothing was written");
  });
});
