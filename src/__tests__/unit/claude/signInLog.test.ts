import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrapErr } from "#lib/result.js";

import {
  appendSignIn,
  type ClaudeSignIn,
  lastSignInByAlias,
  parseSignInLine,
  readSignIns,
  signInLogPath,
} from "../../../claude/signInLog.js";

const homes: string[] = [];

/** A throwaway Slopweaver home. Never the ambient one — every write in this file passes it explicitly. */
const newHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "signin-log-"));
  homes.push(home);
  return home;
};

/** Write a raw log, bypassing the appender, so a reader can be held to bytes the appender would never emit. */
const seed = ({ home, text }: { home: string; text: string }): void => {
  mkdirSync(join(home, "claude-accounts"), { recursive: true });
  writeFileSync(signInLogPath({ home }), text);
};

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("parseSignInLine", () => {
  it("decodes a recorded sign-in", () => {
    expect(parseSignInLine({ line: '{"alias":"plan-two","signedInAtIso":"2026-09-11T09:00:00.000Z"}' })).toEqual({
      alias: "plan-two",
      signedInAtIso: "2026-09-11T09:00:00.000Z",
    });
  });

  it("answers nothing for a blank line", () => {
    expect(parseSignInLine({ line: "   " })).toBeUndefined();
  });

  it("answers nothing for a line that is not JSON at all", () => {
    expect(parseSignInLine({ line: '{"alias":"plan-two"' })).toBeUndefined();
  });

  it("answers nothing for a row missing its instant", () => {
    expect(parseSignInLine({ line: '{"alias":"plan-two"}' })).toBeUndefined();
  });

  it("answers nothing for an empty alias, which names no store", () => {
    expect(parseSignInLine({ line: '{"alias":"","signedInAtIso":"2026-09-11T09:00:00.000Z"}' })).toBeUndefined();
  });

  it("answers nothing for a JSON array, which is not a record", () => {
    expect(parseSignInLine({ line: "[]" })).toBeUndefined();
  });

  it("carries no field beyond the alias and the instant, whatever the line held", () => {
    const parsed = parseSignInLine({
      line: '{"alias":"plan-two","signedInAtIso":"2026-09-11T09:00:00.000Z","organizationId":"org-secret"}',
    });

    expect(Object.keys(parsed!).toSorted()).toEqual(["alias", "signedInAtIso"]);
  });
});

describe("lastSignInByAlias", () => {
  const rows: readonly ClaudeSignIn[] = [
    { alias: "plan-two", signedInAtIso: "2026-09-11T09:00:00.000Z" },
    { alias: "plan-three", signedInAtIso: "2026-09-11T10:00:00.000Z" },
    { alias: "plan-two", signedInAtIso: "2026-09-12T08:00:00.000Z" },
  ];

  it("takes the newest row for the store", () => {
    expect(lastSignInByAlias({ alias: "plan-two", signIns: rows })).toBe("2026-09-12T08:00:00.000Z");
  });

  it("answers nothing for a store the log never recorded", () => {
    expect(lastSignInByAlias({ alias: "plan-four", signIns: rows })).toBeUndefined();
  });

  it("answers nothing over an empty log", () => {
    expect(lastSignInByAlias({ alias: "plan-two", signIns: [] })).toBeUndefined();
  });

  // File order, not the largest instant: a machine whose clock jumped backwards must not be able to hide its
  // own most recent append behind an older row carrying a later timestamp.
  it("takes the LAST row in file order even when an earlier one carries a later instant", () => {
    const skewed: readonly ClaudeSignIn[] = [
      { alias: "plan-two", signedInAtIso: "2027-01-01T00:00:00.000Z" },
      { alias: "plan-two", signedInAtIso: "2026-09-12T08:00:00.000Z" },
    ];

    expect(lastSignInByAlias({ alias: "plan-two", signIns: skewed })).toBe("2026-09-12T08:00:00.000Z");
  });
});

describe("appendSignIn and readSignIns", () => {
  it("round-trips one sign-in through a real file", () => {
    const home = newHome();

    appendSignIn({ alias: "plan-two", home, nowIso: "2026-09-11T09:00:00.000Z" });

    expect(readSignIns({ home })).toEqual([{ alias: "plan-two", signedInAtIso: "2026-09-11T09:00:00.000Z" }]);
  });

  it("keeps every append, in the order they were made", () => {
    const home = newHome();

    appendSignIn({ alias: "plan-two", home, nowIso: "2026-09-11T09:00:00.000Z" });
    appendSignIn({ alias: "plan-three", home, nowIso: "2026-09-11T10:00:00.000Z" });
    appendSignIn({ alias: "plan-two", home, nowIso: "2026-09-12T08:00:00.000Z" });

    expect(readSignIns({ home })).toEqual([
      { alias: "plan-two", signedInAtIso: "2026-09-11T09:00:00.000Z" },
      { alias: "plan-three", signedInAtIso: "2026-09-11T10:00:00.000Z" },
      { alias: "plan-two", signedInAtIso: "2026-09-12T08:00:00.000Z" },
    ]);
  });

  it("reads an absent log as no record, which is the day-one shape of every install", () => {
    expect(readSignIns({ home: newHome() })).toEqual([]);
  });

  it("writes the log under claude-accounts, beside the enrollments it is deliberately not part of", () => {
    const home = newHome();

    expect(signInLogPath({ home })).toBe(`${home}/claude-accounts/sign-in-log.jsonl`);
  });

  // A killed process can leave a file without its trailing newline. Fusing the next append onto that tail
  // would cost BOTH rows, so the appender separates first.
  it("separates an append from a partial final line rather than fusing the two", () => {
    const home = newHome();
    seed({ home, text: '{"alias":"plan-two","signedInAtIso":"2026-09-11T09:00:00.000Z"}' });

    appendSignIn({ alias: "plan-three", home, nowIso: "2026-09-11T10:00:00.000Z" });

    expect(readSignIns({ home })).toEqual([
      { alias: "plan-two", signedInAtIso: "2026-09-11T09:00:00.000Z" },
      { alias: "plan-three", signedInAtIso: "2026-09-11T10:00:00.000Z" },
    ]);
  });

  // Tolerant because the file is APPEND-ONLY: a dropped line costs that line and nothing else, where the
  // enrollments file needed a strict read because every write there rewrites the whole list.
  it("skips a corrupt line and keeps every readable one either side of it", () => {
    const home = newHome();
    seed({
      home,
      text: [
        '{"alias":"plan-two","signedInAtIso":"2026-09-11T09:00:00.000Z"}',
        "{ this is not json",
        '{"alias":"plan-three","signedInAtIso":"2026-09-11T10:00:00.000Z"}',
        "",
      ].join("\n"),
    });

    expect(readSignIns({ home })).toEqual([
      { alias: "plan-two", signedInAtIso: "2026-09-11T09:00:00.000Z" },
      { alias: "plan-three", signedInAtIso: "2026-09-11T10:00:00.000Z" },
    ]);
  });

  // A historical record, so a plan leaving accounts.json does not make the past false — the opposite call
  // from readAssertionsForWrite, which refuses an unconfigured alias because it is about to rewrite the file.
  it("keeps a row naming a store that is no longer configured", () => {
    const home = newHome();
    seed({ home, text: '{"alias":"plan-nine","signedInAtIso":"2026-09-11T09:00:00.000Z"}\n' });

    expect(readSignIns({ home })).toEqual([{ alias: "plan-nine", signedInAtIso: "2026-09-11T09:00:00.000Z" }]);
  });

  it("records nothing but the alias and the instant", () => {
    const home = newHome();

    appendSignIn({ alias: "plan-two", home, nowIso: "2026-09-11T09:00:00.000Z" });
    const [row] = readSignIns({ home });

    expect(Object.keys(row!).toSorted()).toEqual(["alias", "signedInAtIso"]);
  });

  it("answers ok for an append that landed", () => {
    const home = newHome();

    expect(appendSignIn({ alias: "plan-two", home, nowIso: "2026-09-11T09:00:00.000Z" }).isOk()).toBe(true);
  });

  // The record runs between a completed browser login and the enrollment that binds the store, so a throw
  // here costs the owner the whole login. It REPORTS instead, and signinEnrolment.test.ts holds the caller
  // to carrying on. Repro: chmod 0o500 a home and append.
  it("reports an unwritable home rather than throwing, naming the path it could not write", () => {
    const home = newHome();
    chmodSync(home, 0o500);

    const failed = appendSignIn({ alias: "plan-two", home, nowIso: "2026-09-11T09:00:00.000Z" });
    chmodSync(home, 0o700);

    expect(unwrapErr(failed).operation).toBe("appendSignIn");
    expect(unwrapErr(failed).path).toBe(signInLogPath({ home }));
    expect(unwrapErr(failed).code).toBe("EACCES");
  });
});
