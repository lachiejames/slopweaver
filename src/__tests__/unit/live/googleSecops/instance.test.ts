/**
 * Unit: which Chronicle instance a home names, and the one origin that instance may be reached on.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseSecopsInstance, resolveSecopsInstance } from "../../../../live/googleSecops/instance.js";

/** A fixture instance in the shape a SecOps settings page prints its own name. */
const MEASURED = "projects/acme-security/locations/australia-southeast1/instances/00000000-0000-4000-8000-000000000001";

const homes: string[] = [];

/** A throwaway state home, optionally holding a configured instance. */
function scratchHome({ instance }: { instance: string | null }): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-secops-instance-"));
  homes.push(home);
  if (instance !== null) {
    mkdirSync(join(home, "secrets"), { recursive: true });
    writeFileSync(join(home, "secrets", "google-secops-instance"), `${instance}\n`, { mode: 0o600 });
  }
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("parseSecopsInstance", () => {
  it("derives the regional origin from the measured instance's own location", () => {
    expect(unwrap(parseSecopsInstance({ value: MEASURED }))).toStrictEqual({
      location: "australia-southeast1",
      name: MEASURED,
      origin: "https://australia-southeast1-chronicle.googleapis.com",
    });
  });

  it("takes a multi-region location and a project number", () => {
    const value = "projects/123456789012/locations/us/instances/00000000-0000-4000-8000-000000000001";
    expect(unwrap(parseSecopsInstance({ value })).origin).toBe("https://us-chronicle.googleapis.com");
  });

  it("refuses a location that would steer the origin off the chronicle host", () => {
    const value = "projects/acme-security/locations/evil.example.com#/instances/00000000-0000-4000-8000-000000000001";
    expect(unwrapErr(parseSecopsInstance({ value })).code).toBe("INSTANCE_MALFORMED");
  });

  it("refuses an instance id that is not a uuid", () => {
    const value = "projects/acme-security/locations/australia-southeast1/instances/not-a-uuid";
    const error = unwrapErr(parseSecopsInstance({ value }));
    expect(error.code).toBe("INSTANCE_MALFORMED");
    expect(error.message).toContain("projects/<project>/locations/<location>/instances/<uuid>");
  });

  it("refuses a bare instance id, which names no location and so no host", () => {
    expect(unwrapErr(parseSecopsInstance({ value: "00000000-0000-4000-8000-000000000001" })).code).toBe(
      "INSTANCE_MALFORMED",
    );
  });
});

describe("resolveSecopsInstance", () => {
  it("names the secret to set when the home holds no instance", () => {
    const error = unwrapErr(resolveSecopsInstance({ home: scratchHome({ instance: null }) }));
    expect(error.code).toBe("INSTANCE_MISSING");
    expect(error.message).toContain("slopweaver secrets set google-secops-instance");
  });

  it("reads the stored instance, trimmed", () => {
    const resolved = unwrap(resolveSecopsInstance({ home: scratchHome({ instance: MEASURED }) }));
    expect(resolved.origin).toBe("https://australia-southeast1-chronicle.googleapis.com");
  });
});
