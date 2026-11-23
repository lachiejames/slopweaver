import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { maybeRemindGovernedVerb } from "../../../cli/skillReminderEffects.js";
import { stateHomePaths } from "../../../stateHome.js";

/** A fresh, real temp directory — a genuine fixture round-trip, not a mock. Caller removes it when done. */
function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "slopweaver-skill-reminder-"));
}

describe("maybeRemindGovernedVerb", () => {
  it("prints a reminder the first time a governed verb is called in a session", () => {
    const home = freshHome();
    const lines: string[] = [];
    maybeRemindGovernedVerb({ home, noun: "linear", sessionId: "s1", verb: "issue", writeLine: (l) => lines.push(l) });
    rmSync(home, { force: true, recursive: true });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("/slopweaver:linear");
  });

  it("does not print a second reminder for the same verb in the same session", () => {
    const home = freshHome();
    const lines: string[] = [];
    const call = (): void =>
      maybeRemindGovernedVerb({
        home,
        noun: "linear",
        sessionId: "s1",
        verb: "issue",
        writeLine: (l) => lines.push(l),
      });
    call();
    call();
    rmSync(home, { force: true, recursive: true });
    expect(lines).toHaveLength(1);
  });

  it("does print again for a DIFFERENT session id", () => {
    const home = freshHome();
    const lines: string[] = [];
    const call = ({ sessionId }: { sessionId: string }): void =>
      maybeRemindGovernedVerb({ home, noun: "linear", sessionId, verb: "issue", writeLine: (l) => lines.push(l) });
    call({ sessionId: "s1" });
    call({ sessionId: "s2" });
    rmSync(home, { force: true, recursive: true });
    expect(lines).toHaveLength(2);
  });

  it("does nothing for an ungoverned verb", () => {
    const home = freshHome();
    const lines: string[] = [];
    maybeRemindGovernedVerb({ home, noun: "linear", sessionId: "s1", verb: "read", writeLine: (l) => lines.push(l) });
    rmSync(home, { force: true, recursive: true });
    expect(lines).toHaveLength(0);
  });

  it("does nothing with no session id (a plain-terminal invocation)", () => {
    const home = freshHome();
    const lines: string[] = [];
    maybeRemindGovernedVerb({
      home,
      noun: "linear",
      sessionId: undefined,
      verb: "issue",
      writeLine: (l) => lines.push(l),
    });
    rmSync(home, { force: true, recursive: true });
    expect(lines).toHaveLength(0);
  });

  it("persists the marker to disk so a fresh process invocation still dedups", () => {
    const home = freshHome();
    maybeRemindGovernedVerb({ home, noun: "linear", sessionId: "s1", verb: "issue" });
    const raw = readFileSync(stateHomePaths({ home }).skillRemindersJson, "utf8");
    rmSync(home, { force: true, recursive: true });
    expect(JSON.parse(raw)).toEqual({ s1: ["linear issue"] });
  });

  it("does not throw when the home directory does not exist (fail-open)", () => {
    const missingHome = join(tmpdir(), "slopweaver-skill-reminder-does-not-exist");
    expect(() =>
      maybeRemindGovernedVerb({
        home: missingHome,
        noun: "linear",
        sessionId: "s1",
        verb: "issue",
        writeLine: () => {},
      }),
    ).not.toThrow();
  });
});
