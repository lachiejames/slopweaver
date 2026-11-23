/**
 * The door's decision, including the one deliberate exception.
 *
 * The override has to admit the artifact UNCHANGED and still say what it admitted, because a bypass nobody
 * can see is indistinguishable from a gate that never fired.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { aboveFoldGateRefused, aboveFoldLines, printedAboveFoldRefusals } from "../../../../../cli/aboveFoldDoor.js";
import { aboveFoldVerdict, aboveFoldVerdictOrReported } from "../../../../../cli/commands/github/aboveFoldGate.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { prAboveFoldCells } from "../../../../../outbound/github/aboveFold.js";
import { EXAMPLE_PR_FORM } from "../../../../../outbound/github/formExample.js";
import type { Content, PrFormDraft } from "../../../../../outbound/github/types.js";
import { VOICE_RULES_ESCAPE } from "../../../../../outbound/voice/exactRules.js";
import { type MemoryDoorLedger, memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { envReader, grantedEnv, grantSessionEnv } from "../../../../hatchGrantFixture.js";

// register-class: voice-rules-run-late-and-only-on-one-lane (docs/recurring-failure-register/bindings.md)

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A temp state home carrying one exact voice rule: the em dash. */
function seedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-abovefold-"));
  fixtureDirs.push(home);
  writeFileSync(
    join(home, "profile.json"),
    JSON.stringify({
      displayName: "Ada Owner",
      gitNamespace: "ada-gh",
      id: "owner-1",
      schemaVersion: 1,
      slackMe: { userId: "U_OWNER", voice: { exact: [{ kind: "literal", value: "—" }] } },
      sources: ["github"],
    }),
    "utf8",
  );
  return home;
}

/** The example form with one above-the-fold cell replaced: the explainer, or its one check. */
function formWith({ text, field }: { text: string; field: "explainer" | "check" }): PrFormDraft {
  const content: Content = [{ kind: "text", text }];
  if (field === "check") {
    return { ...EXAMPLE_PR_FORM, checks: [content] };
  }
  return { ...EXAMPLE_PR_FORM, explainer: content };
}

const NO_ENV = (): string | undefined => undefined;

/**
 * An environment reader naming a session that holds a live voice-rules grant in `home`'s journal — the same
 * home the verdict is asked under, since the door reads the grant from the home it was handed.
 *
 * @returns the reader the door's `env` seam takes
 */
function overrideEnv({ home }: { home: string }): (args: { name: string }) => string | undefined {
  return envReader({ env: grantedEnv({ hatchIds: ["voice-rules"], home }) });
}

describe("aboveFoldVerdict", () => {
  it("accepts the canonical example form", () => {
    const verdict = unwrap(aboveFoldVerdict({ env: NO_ENV, form: EXAMPLE_PR_FORM, home: seedHome() }));
    expect(verdict).toStrictEqual({
      findings: [],
      lengthCalibration: "uncalibrated",
      lengthWarnings: [],
      refusals: [],
      surface: "github",
      warnings: [],
    });
  });

  it("refuses an em dash in the explainer, naming the field and the override", () => {
    const verdict = unwrap(
      aboveFoldVerdict({
        env: NO_ENV,
        form: formWith({ field: "explainer", text: "we deleted the entry — yarn did the rest." }),
        home: seedHome(),
      }),
    );
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.refusals).toHaveLength(1);
    expect(verdict.refusals[0]).toContain("explainer:");
    expect(verdict.refusals[0]).toContain(`${VOICE_RULES_ESCAPE}; the grant sends the original content unchanged.`);
  });

  it("still refuses with the retired variable set and no grant, because a variable leaves no journal row", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-abovefold-nogrant-"));
    fixtureDirs.push(home);
    const env = envReader({ env: { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_VOICE_RULES: "1" } });
    const verdict = unwrap(
      aboveFoldVerdict({
        env,
        form: formWith({ field: "explainer", text: "we deleted the entry — yarn did the rest." }),
        home: seedHome(),
      }),
    );
    expect(verdict.refusals).toHaveLength(1);
  });

  it("refuses a colon-introduced list in a check", () => {
    const verdict = unwrap(
      aboveFoldVerdict({
        env: NO_ENV,
        form: formWith({ field: "check", text: "three broke: the pool, the queue, and the cache." }),
        home: seedHome(),
      }),
    );
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.refusals[0]).toContain("checks[0]:");
    expect(verdict.refusals[0]).toContain("one sentence per fact");
  });

  it("admits the same body under a live voice-rules grant, and still reports what it admitted", () => {
    const home = seedHome();
    const verdict = unwrap(
      aboveFoldVerdict({
        env: overrideEnv({ home }),
        form: formWith({ field: "explainer", text: "we deleted the entry — yarn did the rest." }),
        home,
      }),
    );
    expect(verdict.refusals).toStrictEqual([]);
    expect(verdict.findings.map((finding) => finding.code)).toStrictEqual(["voice-rule"]);
  });

  it("finds nothing structural and nothing exact when no profile is configured", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-abovefold-none-"));
    fixtureDirs.push(home);
    const verdict = unwrap(
      aboveFoldVerdict({
        env: NO_ENV,
        form: formWith({ field: "explainer", text: "we deleted the entry — yarn did the rest." }),
        home,
      }),
    );
    expect(verdict).toStrictEqual({
      findings: [],
      lengthCalibration: "uncalibrated",
      lengthWarnings: [],
      refusals: [],
      surface: "github",
      warnings: [],
    });
  });

  it("still refuses a STRUCTURAL violation with no profile, because that rule is the repository's own", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-abovefold-none-"));
    fixtureDirs.push(home);
    const verdict = unwrap(
      aboveFoldVerdict({
        env: NO_ENV,
        form: formWith({ field: "check", text: "three broke: the pool, the queue, and the cache." }),
        home,
      }),
    );
    expect(verdict.findings).toHaveLength(1);
  });
});

describe("aboveFoldLines", () => {
  it("says ACCEPTS when nothing was found", () => {
    expect(
      aboveFoldLines({
        verdict: {
          findings: [],
          lengthCalibration: "measured",
          lengthWarnings: [],
          refusals: [],
          surface: "github",
          warnings: [],
        },
      }),
    ).toStrictEqual([
      "above-the-fold gate: ACCEPTS this body",
      "measured length register: within the measured threshold",
      "",
    ]);
  });

  it("lists every refusal under one REFUSES heading", () => {
    expect(
      aboveFoldLines({
        verdict: {
          findings: [],
          lengthCalibration: "measured",
          lengthWarnings: [],
          refusals: ["problem: a", "solution: b"],
          surface: "github",
          warnings: [],
        },
      })[0],
    ).toBe("above-the-fold gate: REFUSES this body:\n  - problem: a\n  - solution: b");
  });

  it("names the override rather than claiming a clean body", () => {
    const findings = [
      { code: "voice-rule" as const, message: "m", path: "problem" },
      { code: "colon-list" as const, message: "m", path: "solution" },
    ];
    expect(
      aboveFoldLines({
        verdict: {
          findings,
          lengthCalibration: "measured",
          lengthWarnings: [],
          refusals: [],
          surface: "github",
          warnings: [],
        },
      })[0],
    ).toBe("above-the-fold gate: 2 violation(s) OVERRIDDEN by this session's live voice-rules grant");
  });
});

/** The example form whose re-run fold carries one note of the given prose, below the fold. */
function formFoldedWith({ text }: { text: string }): PrFormDraft {
  return { ...EXAMPLE_PR_FORM, rerun: [{ content: [{ kind: "text", text }], kind: "note" }] };
}

describe("the below-the-fold half of the gate", () => {
  it("WARNS on prose below the fold and refuses nothing, which is the owner's ruling", () => {
    const verdict = unwrap(
      aboveFoldVerdict({
        env: NO_ENV,
        form: formFoldedWith({ text: "the pool exhausted — overnight" }),
        home: seedHome(),
      }),
    );
    expect(verdict.refusals).toStrictEqual([]);
    expect(verdict.findings).toStrictEqual([]);
    expect(verdict.warnings).toHaveLength(1);
    expect(verdict.warnings[0]).toContain("rerun[0].content");
  });

  it("still REFUSES the same prose above the fold, so the two halves have different consequences", () => {
    const verdict = unwrap(
      aboveFoldVerdict({
        env: NO_ENV,
        form: formWith({ field: "check", text: "the pool exhausted — overnight" }),
        home: seedHome(),
      }),
    );
    expect(verdict.refusals).toHaveLength(1);
    expect(verdict.warnings).toStrictEqual([]);
  });

  it("reads a re-run test-list line, which the above-the-fold slice never included", () => {
    const form: PrFormDraft = {
      ...EXAMPLE_PR_FORM,
      rerun: [{ items: [[{ kind: "text", text: "the workings — all of them" }]], kind: "tests" }],
    };
    const verdict = unwrap(aboveFoldVerdict({ env: NO_ENV, form, home: seedHome() }));
    expect(verdict.refusals).toStrictEqual([]);
    expect(verdict.warnings[0]).toContain("rerun[0].items[0]");
  });

  it("prints the warning on its own channel, never the refusal prefix a caller greps for", async () => {
    const lines: string[] = [];
    const refused = await printedAboveFoldRefusals({
      home: seedHome(),
      ledger: memoryDoorLedger().port,
      out: ({ line }) => {
        lines.push(line);
      },
      verdict: unwrap(
        aboveFoldVerdict({
          env: NO_ENV,
          form: formFoldedWith({ text: "the pool exhausted — overnight" }),
          home: seedHome(),
        }),
      ),
    });
    expect(refused).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.startsWith("warning: below the fold, ")).toBe(true);
    expect(lines[0]).toContain("This never blocks the write");
  });

  it("says nothing below the fold under a live voice-rules grant, matching the above-fold half", () => {
    const home = seedHome();
    const verdict = unwrap(
      aboveFoldVerdict({
        env: overrideEnv({ home }),
        form: formFoldedWith({ text: "the pool exhausted — overnight" }),
        home,
      }),
    );
    expect(verdict.warnings).toStrictEqual([]);
  });

  it("reports the warning in a dry run's own lines, before the trailing blank", () => {
    const lines = aboveFoldLines({
      verdict: unwrap(
        aboveFoldVerdict({
          env: NO_ENV,
          form: formFoldedWith({ text: "the pool exhausted — overnight" }),
          home: seedHome(),
        }),
      ),
    });
    expect(lines[0]).toBe("above-the-fold gate: ACCEPTS this body");
    expect(lines[1]).toContain("warning: below the fold");
    // The dry run also states whether the measured length register could judge this surface at all. An
    // unseeded home has no cached register, so the honest answer here is NOT CALIBRATED rather than clean.
    expect(lines[2]).toBe(
      "measured length register: NOT CALIBRATED for this surface — the length half of the gate did not run",
    );
    expect(lines[3]).toBe("");
  });
});

describe("a profile.json that is there but corrupt", () => {
  /** A temp state home whose profile.json is not JSON. */
  function corruptHome(): string {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-abovefold-"));
    fixtureDirs.push(home);
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    return home;
  }

  it("reaches no verdict, naming the profile, and the voice override does not lift that", () => {
    const home = corruptHome();
    const path = join(home, "profile.json");
    for (const env of [NO_ENV, overrideEnv({ home })]) {
      const refused = unwrapErr(aboveFoldVerdict({ env, form: EXAMPLE_PR_FORM, home }));
      expect(refused.code).toBe("PROFILE_UNREADABLE");
      expect(refused.path).toBe(path);
      expect(refused.message).toContain(`the profile at ${path} is there but cannot be trusted`);
    }
  });

  it("refuses a profile.json that is a named pipe rather than hanging on it", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-abovefold-"));
    fixtureDirs.push(home);
    execFileSync("mkfifo", [join(home, "profile.json")]);
    expect(unwrapErr(aboveFoldVerdict({ env: NO_ENV, form: EXAMPLE_PR_FORM, home })).code).toBe("PROFILE_UNREADABLE");
  });

  it("still reads a missing profile as an install with no rules, so an em dash passes", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-abovefold-"));
    fixtureDirs.push(home);
    const verdict = unwrap(
      aboveFoldVerdict({ env: NO_ENV, form: formWith({ field: "explainer", text: "Fast — and safe." }), home }),
    );
    expect(verdict.refusals).toStrictEqual([]);
  });

  it("refuses at the door with the profile's own message and writes no refusal row, which a rule that fired does", async () => {
    const form = formWith({ field: "explainer", text: "Fast — and safe." });
    const gate = async ({
      home,
      door,
    }: {
      home: string;
      door: MemoryDoorLedger;
    }): Promise<{ refused: boolean; lines: string[] }> => {
      const lines: string[] = [];
      const refused = await aboveFoldGateRefused({
        belowFoldCells: [],
        cells: prAboveFoldCells({ form }),
        dryRun: false,
        env: NO_ENV,
        home,
        ledger: door.port,
        out: ({ line }) => lines.push(line),
        surface: "github",
      });
      return { lines, refused };
    };
    const corrupt = corruptHome();
    const corruptDoor = memoryDoorLedger();
    expect(await gate({ door: corruptDoor, home: corrupt })).toStrictEqual({
      lines: [`refused: ${unwrapErr(aboveFoldVerdict({ env: NO_ENV, form, home: corrupt })).message}`],
      refused: true,
    });
    expect(corruptDoor.store.rows).toStrictEqual([]);
    const seededDoor = memoryDoorLedger();
    expect((await gate({ door: seededDoor, home: seedHome() })).refused).toBe(true);
    expect(seededDoor.store.rows.length).toBe(1);
  });
});

describe("aboveFoldVerdictOrReported", () => {
  const form = formWith({ field: "explainer", text: "Fast — and safe." });
  const report = async ({ home, refuseFindings }: { home: string; refuseFindings: boolean }) => {
    const lines: string[] = [];
    const door = memoryDoorLedger();
    const verdict = await aboveFoldVerdictOrReported({
      env: NO_ENV,
      form,
      home,
      ledger: door.port,
      out: ({ line }) => lines.push(line),
      refuseFindings,
    });
    return { door, lines, verdict };
  };

  it("prints a corrupt profile's refusal and hands back nothing, whether or not findings refuse", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-abovefold-"));
    fixtureDirs.push(home);
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    const message = unwrapErr(aboveFoldVerdict({ env: NO_ENV, form, home })).message;
    for (const refuseFindings of [false, true]) {
      const { door, lines, verdict } = await report({ home, refuseFindings });
      expect({ lines, verdict }).toStrictEqual({ lines: [`refused: ${message}`], verdict: undefined });
      expect(door.store.rows).toStrictEqual([]);
    }
  });

  it("hands a refusing verdict back unprinted when findings do not refuse here", async () => {
    const home = seedHome();
    const { door, lines, verdict } = await report({ home, refuseFindings: false });
    expect(lines).toStrictEqual([]);
    expect(verdict!.refusals.length).toBe(1);
    expect(door.store.rows).toStrictEqual([]);
  });

  it("prints and records a refusing verdict, then hands back nothing, when findings refuse here", async () => {
    const home = seedHome();
    const { door, lines, verdict } = await report({ home, refuseFindings: true });
    expect(verdict).toBe(undefined);
    expect(lines[0]).toContain("refused: ");
    expect(door.store.rows.length).toBe(1);
  });
});
