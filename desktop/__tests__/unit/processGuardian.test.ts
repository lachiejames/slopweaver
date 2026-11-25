/*
 * The Codex worker's guardian stamp: parsed from one `ps -o stat=,lstart=` row exactly as the CLI's
 * `processStartFromPs` reads it, asked for the same way, and handed down under the same two field names the CLI's
 * `src/admit/processGuardian.ts` reads. Neither tree can import the other, so the shared text is read from source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  GUARDIAN_PID_ENV,
  GUARDIAN_PS_ENVIRONMENT,
  GUARDIAN_PS_FIELDS,
  GUARDIAN_START_ENV,
  guardianStampFromPs,
} from "../../src/sessionWorker/processGuardian";

const REPO = join(__dirname, "..", "..", "..");

/** The `lstart` shape both parsers accept, as it is spelled in each source. */
const LSTART_LITERAL = String.raw`/^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/u`;

describe("guardianStampFromPs", () => {
  it("keeps a space-padded day's two spaces byte for byte", () => {
    expect(guardianStampFromPs({ text: "Ss   Wed Nov  5 09:01:02 2026\n" })).toBe("Wed Nov  5 09:01:02 2026");
  });

  it("reads a two-digit day the same way", () => {
    expect(guardianStampFromPs({ text: "S+   Tue Nov 25 05:42:34 2026\n" })).toBe("Tue Nov 25 05:42:34 2026");
  });

  it("is no stamp for a zombie", () => {
    expect(guardianStampFromPs({ text: "Z    Wed Nov  5 09:01:02 2026\n" })).toBeUndefined();
  });

  it("is no stamp when ps printed nothing", () => {
    expect(guardianStampFromPs({ text: "" })).toBeUndefined();
  });

  it("is no stamp for a state with no stamp after it", () => {
    expect(guardianStampFromPs({ text: "Ss\n" })).toBeUndefined();
  });

  it("is no stamp for two rows", () => {
    const text = "Ss   Wed Nov  5 09:01:02 2026\nSs   Wed Nov  5 09:01:03 2026\n";
    expect(guardianStampFromPs({ text })).toBeUndefined();
  });

  it("is no stamp for one not shaped as lstart in the C locale", () => {
    expect(guardianStampFromPs({ text: "Ss   mer.  5 nov. 09:01:02 2026\n" })).toBeUndefined();
  });
});

describe("the guardian matches the CLI byte for byte", () => {
  const relayLease = readFileSync(join(REPO, "src", "talk", "relayLease.ts"), "utf8");
  const cliGuardian = readFileSync(join(REPO, "src", "admit", "processGuardian.ts"), "utf8");
  const desktopGuardian = readFileSync(join(REPO, "desktop", "src", "sessionWorker", "processGuardian.ts"), "utf8");

  it("asks ps for the same columns the CLI's probe asks for", () => {
    expect(relayLease).toContain(`"${GUARDIAN_PS_FIELDS}"`);
  });

  it("runs ps under the same locale and timezone, inheriting nothing else", () => {
    const entries = Object.entries(GUARDIAN_PS_ENVIRONMENT);
    expect(entries.length).toBeGreaterThan(0);
    const spelled = entries.map(([name, value]) => `${name}: "${value}"`).join(", ");
    expect(relayLease).toContain(`env: { ${spelled} }`);
  });

  it("accepts the same lstart shape the CLI's probe accepts", () => {
    expect(relayLease).toContain(LSTART_LITERAL);
    expect(desktopGuardian).toContain(LSTART_LITERAL);
  });

  it("hands the guardian down under the two names the CLI reads", () => {
    expect(cliGuardian).toContain(`"${GUARDIAN_PID_ENV}"`);
    expect(cliGuardian).toContain(`"${GUARDIAN_START_ENV}"`);
  });

  it("names neither field as an override, nor with a word Codex's default shell excludes drop (KEY, SECRET, TOKEN)", () => {
    expect(
      [GUARDIAN_PID_ENV, GUARDIAN_START_ENV].filter((name) => /ALLOW|OVERRIDE|KEY|SECRET|TOKEN/u.test(name)),
    ).toEqual([]);
  });
});
