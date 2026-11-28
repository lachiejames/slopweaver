import { describe, expect, it } from "vitest";
import { lintChecks } from "../../../../devLint/devLint.js";
import { bespokeRatchets, externalChecks } from "../../../../devLint/gateGroups.js";

describe("gateGroups", () => {
  const bin = ({ name }: { name: string }): string => `/bin/${name}`;

  it("splits the registry into the external checks and the bespoke ratchets, and lintChecks is their concatenation", () => {
    const external = externalChecks({ bin });
    const bespoke = bespokeRatchets({ bin });
    const whole = lintChecks({ cwd: "/repo" }).map((check) => check.name);
    expect(whole).toEqual([...external, ...bespoke].map((check) => check.name));
  });

  it("resolves every bin through the resolver it is given rather than a hard-coded path", () => {
    const commands = externalChecks({ bin }).map((check) => check.cmd);
    expect(commands.slice(0, 2)).toEqual(["/bin/biome", "/bin/prettier"]);
  });

  it("hands the runtime-dependencies gate's esbuild service the shared Go soft memory limit", () => {
    const gate = bespokeRatchets({ bin }).find((check) => check.name === "runtime-dependencies")!;
    expect(gate.env).toEqual({ GOMEMLIMIT: "4096MiB" });
  });
});
