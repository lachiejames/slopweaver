/** `resolveProbeSet`: a `--probes` value read as a literal document or a file, decoded and validated. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveProbeSet } from "../../../../../cli/commands/datadog/alertDigestProbeSet.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const PROBE = {
  id: "send-failures",
  kind: "logs-count",
  query: "service:example-api status:error",
  severityWhenFiring: "orange",
  title: "send failures",
  why: "the outer send catch, wrapping every transport",
};
const DOCUMENT = JSON.stringify({ probes: [PROBE] });

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("resolveProbeSet", () => {
  it("reads a literal JSON document into a runnable set", async () => {
    const set = unwrap(await resolveProbeSet({ value: DOCUMENT }));
    expect(set.probes.map((probe) => probe.id)).toEqual(["send-failures"]);
  });

  it("reads a path to a document", async () => {
    const dir = mkdtempSync(join(tmpdir(), "probes-"));
    dirs.push(dir);
    const path = join(dir, "probes.json");
    writeFileSync(path, DOCUMENT);
    const set = unwrap(await resolveProbeSet({ value: path }));
    expect(set.probes[0]!.title).toBe("send failures");
  });

  it("refuses a path that is not a readable file, naming it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "probes-"));
    dirs.push(dir);
    const missing = join(dir, "absent.json");
    const refused = unwrapErr(await resolveProbeSet({ value: missing }));
    expect(refused.length).toBe(1);
    expect(refused[0]).toContain(`the probe document could not be read as JSON: --probes '${missing}'`);
  });

  it("refuses a document that is not JSON", async () => {
    const refused = unwrapErr(await resolveProbeSet({ value: "{ not json" }));
    expect(refused.length).toBe(1);
    expect(refused[0]).toContain("the probe document could not be read as JSON");
  });

  it("refuses a document whose shape is not a probe set", async () => {
    const refused = unwrapErr(await resolveProbeSet({ value: JSON.stringify({ probes: [] }) }));
    expect(refused.length).toBe(1);
    expect(refused[0]).toContain("not a probe set: ");
  });
});
