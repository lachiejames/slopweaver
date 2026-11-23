/**
 * A capability row graded on whether the executables it names can be run at all.
 *
 * The row this closes was registered because the live install's `telemetry` row declared itself `available`
 * while running `yarn work-console datadog reach …` — a script that exists in no `package.json` on the host.
 * So the cases below are the three verdicts, and the one distinction that keeps the refusal honest: a
 * namespace that completely answers the question may refuse a row, and `PATH` may not.
 *
 * The second half is the `bash -c` shape the first fix declared as its own blind spot. The live install's
 * `github-vulnerability-evidence` row wrapped two `yarn work-console` calls in a shell string and planned as
 * `available` for vulnerability questions on the strength of `bash` existing, so the cases below fix both
 * that a shell string yields the keys inside it and that everything else in one still yields nothing.
 */
import { describe, expect, it } from "vitest";

import {
  type CommandRouteReading,
  commandExecutableKeysOf,
  deriveCommandCapabilities,
  deriveCommandCapability,
} from "../../../route/commandReading.js";
import type { SourceCapability } from "../../../route/profile.js";

const DECLARED_DETAIL = "the Datadog atlas states coverage per result";

/** The `bash -c` script the live install's `github-vulnerability-evidence` row really carried. */
const MEASURED_SHELL_SCRIPT =
  "set -euo pipefail; EVJSON=$(yarn work-console github vulnerability-evidence --repo acme/acme-admin" +
  ' --severity critical --json); ARTIFACT=$(printf \'%s\' "$EVJSON" | python3 -c "import json,sys;' +
  " print(json.load(sys.stdin)['artifactPath'])\"); yarn work-console github vulnerability-card" +
  ' --evidence "$ARTIFACT"';

/** One private-profile row as the live install declares them: available, current, with a real argv. */
function row({ over }: { over: Partial<SourceCapability> }): SourceCapability {
  return {
    availability: { kind: "available" },
    command: ["slopweaver", "atlas", "datadog", "read"],
    coverage: { detail: DECLARED_DETAIL, kind: "bounded" },
    effect: "read",
    freshness: { detail: "the last published generation", kind: "cached" },
    id: "telemetry",
    owner: "slopweaver",
    sourceClass: "atlas",
    terms: ["datadog"],
    truthMode: "current",
    what: "the observed Datadog estate",
    ...over,
  };
}

/** A grading, defaulted to the verdict that changes nothing so a case states only what it is about. */
function reading({ over }: { over: Partial<CommandRouteReading> }): CommandRouteReading {
  return {
    because: "`slopweaver` is the executable file /tmp/bin/slopweaver",
    executable: "slopweaver",
    resolution: "resolved",
    ...over,
  };
}

describe("commandExecutableKeysOf", () => {
  it("keys a bare executable by its own name", () => {
    expect(commandExecutableKeysOf({ capability: row({ over: { command: ["rg", "-n", "pattern"] } }) })).toEqual([
      "rg",
    ]);
  });

  it("keys `yarn <script>` by the PAIR, because yarn resolving proves nothing about the script", () => {
    const capability = row({ over: { command: ["yarn", "work-console", "datadog", "reach"] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["yarn work-console"]);
  });

  it("keys bare `yarn` by itself when the next argv element is a flag, not a script", () => {
    expect(commandExecutableKeysOf({ capability: row({ over: { command: ["yarn", "--version"] } }) })).toEqual([
      "yarn",
    ]);
  });

  it("keys bare `yarn` by itself when nothing follows it", () => {
    expect(commandExecutableKeysOf({ capability: row({ over: { command: ["yarn"] } }) })).toEqual(["yarn"]);
  });

  it("answers nothing for a row that declares no command at all", () => {
    const capability = row({
      over: { availability: { kind: "unavailable", reason: "no reader exists" }, command: [] },
    });
    expect(commandExecutableKeysOf({ capability })).toEqual([]);
  });

  it("reads the live install's own `bash -c` row for the yarn pair inside it, deduplicated", () => {
    const capability = row({ over: { command: ["bash", "-c", MEASURED_SHELL_SCRIPT] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["bash", "yarn work-console"]);
  });

  it("reads a yarn call opened by a command substitution, which is how the measured row spelled its first", () => {
    const capability = row({ over: { command: ["bash", "-c", "OUT=$(yarn build --json)"] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["bash", "yarn build"]);
  });

  it("keys every distinct yarn script a shell string names, in the order it names them", () => {
    const capability = row({ over: { command: ["sh", "-c", "yarn first --json && yarn second"] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["sh", "yarn first", "yarn second"]);
  });

  it("keys bare `yarn` when the shell string's yarn call is followed by a flag", () => {
    const capability = row({ over: { command: ["zsh", "-c", "yarn --version"] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["zsh", "yarn"]);
  });

  it("skips a yarn token carrying a shell expansion, which names something only the run knows", () => {
    const capability = row({ over: { command: ["bash", "-c", 'yarn "$SCRIPT" --json'] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["bash"]);
  });

  it("does not match `yarn` as a substring of a longer word", () => {
    const capability = row({ over: { command: ["bash", "-c", "myarn build && caryarn ship"] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["bash"]);
  });

  it("does not refuse a row on the word `yarn` inside a message, which is not command position", () => {
    const capability = row({ over: { command: ["bash", "-c", 'echo "regenerate it with yarn build first"'] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["bash"]);
  });

  it("reads a yarn call on its own line of a multi-line script", () => {
    const capability = row({ over: { command: ["bash", "-c", "set -euo pipefail\nyarn build --json\n"] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["bash", "yarn build"]);
  });

  it("misses an env-prefixed yarn call rather than guessing — a false negative, stated in the pattern", () => {
    const capability = row({ over: { command: ["bash", "-c", "CI=1 yarn build"] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["bash"]);
  });

  it("yields no yarn key from a script that changes directory, since the tree it would resolve against moved", () => {
    const capability = row({ over: { command: ["bash", "-c", "cd ../acme-admin && yarn evidence:vuln"] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["bash"]);
  });

  it("drops the readable half too when a later `cd` unsettles it, rather than keeping the wrong half", () => {
    const capability = row({ over: { command: ["bash", "-c", "yarn build\ncd ../other\nyarn ship"] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["bash"]);
  });

  it("does not treat `cdk` or `cdn` as a directory change, so a real yarn call beside one is still read", () => {
    const capability = row({ over: { command: ["bash", "-c", "cdk synth && yarn build"] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["bash", "yarn build"]);
  });

  it("yields no yarn key from a heredoc body, whose lines are data passed on rather than commands", () => {
    const capability = row({ over: { command: ["bash", "-c", "cat <<EOF\nyarn work-console foo\nEOF"] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["bash"]);
  });

  it("grades a shell head with no `-c` script on the head alone", () => {
    const capability = row({ over: { command: ["bash", "/opt/run.sh"] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["bash"]);
  });

  it("leaves a non-shell head's arguments unread, so `-c` to something else yields only the head", () => {
    const capability = row({ over: { command: ["node", "-c", "yarn work-console datadog reach"] } });
    expect(commandExecutableKeysOf({ capability })).toEqual(["node"]);
  });
});

describe("deriveCommandCapability", () => {
  it("leaves a resolved row exactly as declared", () => {
    const derived = deriveCommandCapability({ capability: row({ over: {} }), readings: [reading({ over: {} })] });
    expect(derived.availability.kind).toBe("available");
    expect(derived.command).toEqual(["slopweaver", "atlas", "datadog", "read"]);
    expect(derived.coverage.detail).toBe(DECLARED_DETAIL);
  });

  it("refuses a missing row, clearing the argv that would otherwise reach a worker's brief", () => {
    const because = "`yarn work-console` names no script in /repo/package.json";
    const derived = deriveCommandCapability({
      capability: row({ over: { command: ["yarn", "work-console", "datadog", "reach"] } }),
      readings: [reading({ over: { because, executable: "yarn work-console", resolution: "missing" } })],
    });
    expect(derived.availability).toEqual({
      kind: "unavailable",
      reason: `the command this row names cannot run here: ${because}`,
    });
    expect(derived.command).toEqual([]);
    expect(derived.coverage).toEqual({ detail: because, kind: "unknown" });
  });

  it("keeps an unprovable row runnable and says the doubt out loud in its own coverage", () => {
    const because = "`rg` is on none of this host's 25 PATH entries — it runs only if the host's own shell defines it";
    const derived = deriveCommandCapability({
      capability: row({ over: { command: ["rg", "-n", "pattern"] } }),
      readings: [reading({ over: { because, executable: "rg", resolution: "unprovable" } })],
    });
    expect(derived.availability.kind).toBe("available");
    expect(derived.command).toEqual(["rg", "-n", "pattern"]);
    expect(derived.coverage.detail).toBe(`${DECLARED_DETAIL}; ${because}`);
    expect(derived.coverage.kind).toBe("bounded");
  });

  it("leaves a row nothing graded exactly as declared", () => {
    const derived = deriveCommandCapability({ capability: row({ over: {} }), readings: [] });
    expect(derived.availability.kind).toBe("available");
    expect(derived.coverage.detail).toBe(DECLARED_DETAIL);
  });

  it("leaves an already-unavailable row alone rather than overwriting the reason it carries", () => {
    const capability = row({
      over: { availability: { kind: "unavailable", reason: "no reader exists" }, command: [] },
    });
    const derived = deriveCommandCapability({
      capability,
      readings: [reading({ over: { resolution: "missing" } })],
    });
    expect(derived.availability).toEqual({ kind: "unavailable", reason: "no reader exists" });
  });

  it("refuses a row whose HEAD resolves but whose shell string names a missing script", () => {
    const because = "`yarn work-console` names no script in /repo/package.json";
    const derived = deriveCommandCapability({
      capability: row({ over: { command: ["bash", "-c", MEASURED_SHELL_SCRIPT] } }),
      readings: [
        reading({ over: { because: "`bash` resolves to /bin/bash", executable: "bash" } }),
        reading({ over: { because, executable: "yarn work-console", resolution: "missing" } }),
      ],
    });
    expect(derived.availability).toEqual({
      kind: "unavailable",
      reason: `the command this row names cannot run here: ${because}`,
    });
    expect(derived.command).toEqual([]);
  });

  it("names EVERY key holding the worst verdict, so a row chaining two dead scripts says both", () => {
    const derived = deriveCommandCapability({
      capability: row({ over: { command: ["bash", "-c", "yarn first; yarn second"] } }),
      readings: [
        reading({ over: { executable: "bash" } }),
        reading({ over: { because: "`yarn first` names no script", executable: "yarn first", resolution: "missing" } }),
        reading({
          over: { because: "`yarn second` names no script", executable: "yarn second", resolution: "missing" },
        }),
      ],
    });
    expect(derived.availability).toEqual({
      kind: "unavailable",
      reason: "the command this row names cannot run here: `yarn first` names no script; `yarn second` names no script",
    });
  });

  it("lets one missing key outrank an unprovable one rather than only annotating the doubt", () => {
    const derived = deriveCommandCapability({
      capability: row({ over: { command: ["bash", "-c", "yarn gone"] } }),
      readings: [
        reading({ over: { because: "`bash` is on no PATH entry", executable: "bash", resolution: "unprovable" } }),
        reading({ over: { because: "`yarn gone` names no script", executable: "yarn gone", resolution: "missing" } }),
      ],
    });
    expect(derived.availability).toEqual({
      kind: "unavailable",
      reason: "the command this row names cannot run here: `yarn gone` names no script",
    });
  });

  it("carries every unprovable key's doubt when nothing on the row is outright missing", () => {
    const derived = deriveCommandCapability({
      capability: row({ over: { command: ["bash", "-c", "yarn maybe"] } }),
      readings: [
        reading({ over: { because: "`bash` is on no PATH entry", executable: "bash", resolution: "unprovable" } }),
        reading({
          over: { because: "`yarn maybe` could not be read", executable: "yarn maybe", resolution: "unprovable" },
        }),
      ],
    });
    expect(derived.availability.kind).toBe("available");
    expect(derived.coverage.detail).toBe(
      `${DECLARED_DETAIL}; \`bash\` is on no PATH entry; \`yarn maybe\` could not be read`,
    );
  });
});

describe("deriveCommandCapabilities", () => {
  it("refuses only the rows whose own executable is missing, leaving the table beside them untouched", () => {
    const capabilities = [
      row({ over: { command: ["yarn", "work-console", "datadog", "reach"], id: "telemetry" } }),
      row({ over: { command: ["yarn", "slopweaver", "atlas", "vanta", "read"], id: "vanta-atlas" } }),
      row({ over: { command: ["slopweaver", "atlas", "datadog", "read"], id: "telemetry-live" } }),
    ];
    const readings = new Map<string, CommandRouteReading>([
      [
        "yarn work-console",
        reading({ over: { because: "no such script", executable: "yarn work-console", resolution: "missing" } }),
      ],
      ["yarn slopweaver", reading({ over: { executable: "yarn slopweaver" } })],
      ["slopweaver", reading({ over: {} })],
    ]);
    const derived = deriveCommandCapabilities({ capabilities, readings });
    expect(derived.map((capability) => `${capability.id}:${capability.availability.kind}`)).toEqual([
      "telemetry:unavailable",
      "vanta-atlas:available",
      "telemetry-live:available",
    ]);
  });

  it("refuses the live install's `bash -c` row on the script inside it, not on bash", () => {
    const capabilities = [
      row({ over: { command: ["bash", "-c", MEASURED_SHELL_SCRIPT], id: "github-vuln-evidence" } }),
    ];
    const readings = new Map<string, CommandRouteReading>([
      ["bash", reading({ over: { because: "`bash` resolves to /bin/bash", executable: "bash" } })],
      [
        "yarn work-console",
        reading({
          over: {
            because: "`yarn work-console` names no script in /repo/package.json",
            executable: "yarn work-console",
            resolution: "missing",
          },
        }),
      ],
    ]);
    const [derived] = deriveCommandCapabilities({ capabilities, readings });
    expect(derived!.availability).toEqual({
      kind: "unavailable",
      reason: "the command this row names cannot run here: `yarn work-console` names no script in /repo/package.json",
    });
    expect(derived!.command).toEqual([]);
  });
});
