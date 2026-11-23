import { describe, expect, it } from "vitest";

import { type GoogleAdcDeps, runGoogleAdcWithDeps } from "../../../../../cli/commands/google/adc.js";
import { GOOGLE_ADC_USAGE, GOOGLE_ADC_USAGE_LINE } from "../../../../../cli/commands/google/adcUsage.js";
import { googleManifest } from "../../../../../cli/manifests/google.js";
import type { AdcReading, AdcState } from "../../../../../gcloud/adc.js";
import { err, ok, type Result } from "../../../../../lib/result.js";

const PATH = "/h/.config/gcloud/application_default_credentials.json";

/** A scripted world: each probe returns the next state, each stat the next fingerprint. */
function world({
  states,
  fingerprints = ["f0"],
  env = { HOME: "/h" },
  open = ok([]),
  relay = "chair",
  rowRefused,
}: {
  states: readonly AdcState[];
  fingerprints?: readonly string[];
  env?: Record<string, string>;
  open?: Result<readonly string[]>;
  relay?: "self" | "chair";
  rowRefused?: string;
}): { deps: GoogleAdcDeps; out: string[]; errors: string[]; probes: () => number } {
  const out: string[] = [];
  const errors: string[] = [];
  let now = 0;
  let probes = 0;
  let stats = 0;
  const deps: GoogleAdcDeps = {
    clock: {
      nowMs: () => now,
      sleep: ({ ms }) => {
        now += ms;
        return Promise.resolve();
      },
    },
    env,
    error: (line) => {
      errors.push(line);
    },
    fingerprint: () => {
      const fingerprint = fingerprints[Math.min(stats, fingerprints.length - 1)]!;
      stats += 1;
      return fingerprint;
    },
    openSignins: () => open,
    out: (line) => {
      out.push(line);
    },
    probe: ({ source }) => {
      const state = states[Math.min(probes, states.length - 1)]!;
      probes += 1;
      const reading: AdcReading = { detail: `d-${state}`, source, state };
      return Promise.resolve(reading);
    },
    relay: () => relay,
    rowRefusal: () => rowRefused,
  };
  return { deps, errors, out, probes: () => probes };
}

describe("google adc — one read", () => {
  it("exits 0 on a working credential and prints no note", async () => {
    const w = world({ states: ["valid"] });
    expect(await runGoogleAdcWithDeps({ deps: w.deps, rest: [] })).toBe(0);
    expect(w.out).toEqual([`google adc: valid — d-valid [${PATH}]`]);
  });

  it("exits 3 on a refused credential and prints the chair's one line, then the background wait", async () => {
    const w = world({ states: ["reauth"] });
    expect(await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--row", "review-17961"] })).toBe(3);
    expect(w.out[1]).toContain("send the supervisor this ONE line with SendMessage");
    expect(w.out[2]).toContain("slopweaver hand post --id adc-signin-review-17961");
    expect(w.out[3]).toBe(
      "then wait in the BACKGROUND (never the foreground, never by running the sign-in yourself): slopweaver google adc --row review-17961 --wait --timeout-seconds 28800",
    );
  });

  it("tells the chair itself to post", async () => {
    const w = world({ relay: "self", states: ["absent"] });
    await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--unblocks", "the local lane"] });
    expect(w.out[1]).toBe("post it yourself — you are the supervisor, or none is pinned:");
  });

  it("sends no second line when the owner's note is already up", async () => {
    const w = world({ open: ok(["adc-signin-other-row"]), states: ["absent"] });
    expect(await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--row", "review-17961"] })).toBe(3);
    expect(w.out[1]).toBe(
      "the owner's note is already up: adc-signin-other-row — do not send the supervisor another line",
    );
    expect(w.out.some((line) => line.includes("hand post"))).toBe(false);
  });

  it("still prints the line when the register cannot be read, and says so", async () => {
    const w = world({ open: err(["locked"]), states: ["absent"] });
    await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--row", "r"] });
    expect(w.errors).toEqual([
      "google adc: could not read the hand register (locked) — checking nothing for a duplicate",
    ]);
    expect(w.out[2]).toContain("slopweaver hand post --id adc-signin-r");
  });

  it("asks for a row or unblocks rather than printing a line with neither", async () => {
    const w = world({ states: ["absent"] });
    expect(await runGoogleAdcWithDeps({ deps: w.deps, rest: [] })).toBe(3);
    expect(w.out[1]).toBe(
      "pass --row <slug> or --unblocks <text> for the one line that puts the sign-in on the owner's screen",
    );
  });

  it("refuses a row the board cannot name", async () => {
    const w = world({ rowRefused: "--row nope: not on the board", states: ["absent"] });
    expect(await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--row", "nope"] })).toBe(2);
    expect(w.errors).toEqual(["--row nope: not on the board"]);
  });

  it("refuses a line the note would refuse, naming the rule", async () => {
    const w = world({ states: ["absent"] });
    expect(await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--unblocks", "the gold proof"] })).toBe(2);
    expect(w.errors[0]).toContain("google adc: the note would be refused");
  });

  it("exits 1 with no line when a sign-in cannot fix it: an explicit key file", async () => {
    const w = world({ env: { GOOGLE_APPLICATION_CREDENTIALS: "/k.json", HOME: "/h" }, states: ["reauth"] });
    expect(await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--row", "r", "--wait"] })).toBe(1);
    expect(w.out[1]).toBe(
      "a sign-in cannot fix this: GOOGLE_APPLICATION_CREDENTIALS names /k.json, which gcloud never rewrites — unset it or fix that file",
    );
  });

  it("exits 1 with no line on a failure that is not a refused credential", async () => {
    const w = world({ states: ["failed"] });
    expect(await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--row", "r"] })).toBe(1);
    expect(w.out.some((line) => line.includes("hand post"))).toBe(false);
  });
});

describe("google adc --wait", () => {
  it("answers from memory while the file is unchanged, and probes the moment the owner signs in", async () => {
    const w = world({ fingerprints: ["f0", "f0", "f0", "f1"], states: ["reauth", "valid"] });
    expect(await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--row", "r", "--wait"] })).toBe(0);
    expect(w.probes()).toBe(2);
    expect(w.out.slice(-2)).toEqual([
      "WAIT-DONE google adc valid (read 3 time(s))",
      "settle the owner's note: slopweaver hand done adc-signin-r --did signed-in",
    ]);
  });

  it("settles the note already up when that is the one the owner answered", async () => {
    const w = world({ fingerprints: ["f0", "f1"], open: ok(["adc-signin-first"]), states: ["absent", "valid"] });
    await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--row", "r", "--wait"] });
    expect(w.out.at(-1)).toBe("settle the owner's note: slopweaver hand done adc-signin-first --did signed-in");
  });

  it("re-probes an unchanged file once a minute, in case the credential started working without it", async () => {
    const w = world({ states: ["reauth", "reauth", "valid"] });
    expect(
      await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--row", "r", "--wait", "--timeout-seconds", "600"] }),
    ).toBe(0);
    expect(w.probes()).toBe(3);
  });

  it("exits 4 at the timeout, telling the seat to wait again rather than resend", async () => {
    const w = world({ states: ["reauth"] });
    expect(
      await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--row", "r", "--wait", "--timeout-seconds", "30"] }),
    ).toBe(4);
    expect(w.out.at(-1)).toBe(
      "WAIT-TIMEOUT google adc still reauth after 30s — run the same wait again; do not send another line",
    );
  });
});

describe("google adc — usage", () => {
  it("prints help and exits 0", async () => {
    const w = world({ states: ["valid"] });
    expect(await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--help"] })).toBe(0);
    expect([w.out, w.probes()]).toEqual([[GOOGLE_ADC_USAGE], 0]);
  });

  it("registers the verb with the usage line its help opens on", () => {
    const entry = googleManifest["adc"]!;
    expect([entry.meta.usage, GOOGLE_ADC_USAGE.startsWith(GOOGLE_ADC_USAGE_LINE), entry.meta.effect]).toEqual([
      GOOGLE_ADC_USAGE_LINE,
      true,
      "external-read",
    ]);
  });

  it("refuses an unknown flag, a bad context and a timeout without --wait before any read", async () => {
    const w = world({ states: ["valid"] });
    const codes = [
      await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--bogus"] }),
      await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--context", "home"] }),
      await runGoogleAdcWithDeps({ deps: w.deps, rest: ["--timeout-seconds", "5"] }),
    ];
    expect([codes, w.probes()]).toEqual([[2, 2, 2], 0]);
  });
});
