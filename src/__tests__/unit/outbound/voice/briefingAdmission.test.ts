import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  admitVoiceBriefing,
  BRIEF_FOLLOWS_HEADING,
  recordVoiceBriefing,
  voiceBriefReceiptPath,
} from "../../../../outbound/voice/briefingAdmission.js";
import { voiceBriefDigest } from "../../../../outbound/voice/briefReceipt.js";
import { PROFILE_SCHEMA_VERSION } from "../../../../profile.js";

const homes: string[] = [];
const NOW = "2026-11-08T12:00:00.000Z";
const SESSION = { CLAUDE_CODE_SESSION_ID: "abc-123" };

/** A throwaway home carrying a profile whose voice bans one word. */
function briefedHome({ word = "delve" }: { word?: string } = {}): string {
  const home = mkdtempSync(join(tmpdir(), "voice-briefing-"));
  homes.push(home);
  writeProfile({ home, word });
  return home;
}

/** Write the fixture profile into `home`, banning `word`. */
function writeProfile({ home, word }: { home: string; word: string }): void {
  writeFileSync(
    join(home, "profile.json"),
    JSON.stringify({
      displayName: "Fixture",
      gitNamespace: "",
      id: "fixture",
      schemaVersion: PROFILE_SCHEMA_VERSION,
      slackMe: { voice: { exact: [{ kind: "word", value: word }] } },
      sources: [],
    }),
    "utf8",
  );
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** One admission, with what it printed collected; `env` names the visible session. */
function admit({ env, home }: { env: Readonly<Record<string, string | undefined>>; home: string }): {
  printed: string[];
  result: ReturnType<typeof admitVoiceBriefing>;
} {
  const printed: string[] = [];
  const result = admitVoiceBriefing({ env, home, now: () => NOW, print: (line) => printed.push(line) });
  return { printed, result };
}

describe("admitVoiceBriefing", () => {
  it("refuses an unbriefed session with the registered refusal and the owner's whole brief, and writes its receipt", () => {
    const home = briefedHome();

    const { printed, result } = admit({ env: SESSION, home });

    expect(printed[0]).toContain(
      "blocked because this visible session holds no receipt for the owner's CURRENT voice brief",
    );
    expect(printed).toContain(BRIEF_FOLLOWS_HEADING);
    expect(printed).toContain('  - word (case-insensitive): "delve"');
    expect(unwrapErr(result)[0]).toContain("This session now holds a receipt for the brief above");
    const receipt: unknown = JSON.parse(
      readFileSync(voiceBriefReceiptPath({ home, session: "claude-code:abc-123" }), "utf8"),
    );
    expect(receipt).toEqual({
      briefDigest: voiceBriefDigest({
        brief: { paragraphSpacing: false, rules: [{ kind: "word", value: "delve" }], shape: null },
      }),
      briefedAtIso: NOW,
      session: "claude-code:abc-123",
      version: 1,
    });
    expect(statSync(voiceBriefReceiptPath({ home, session: "claude-code:abc-123" })).mode & 0o777).toBe(0o600);
  });

  it("prints the whole brief BEFORE the receipt exists, so a kill between the two leaves no receipt", () => {
    const home = briefedHome();
    const receiptAt: boolean[] = [];

    admitVoiceBriefing({
      env: SESSION,
      home,
      now: () => NOW,
      print: () => receiptAt.push(existsSync(voiceBriefReceiptPath({ home, session: "claude-code:abc-123" }))),
    });

    expect(receiptAt.length).toBeGreaterThan(0);
    expect(receiptAt.filter(Boolean)).toEqual([]);
    expect(existsSync(voiceBriefReceiptPath({ home, session: "claude-code:abc-123" }))).toBe(true);
  });

  it("refuses a receipt whose bytes are not valid UTF-8, even when they decode to the right session", () => {
    const home = briefedHome();
    const env = { CLAUDE_CODE_SESSION_ID: "bad�id" };
    const session = "claude-code:bad�id";
    const brief = { paragraphSpacing: false, rules: [{ kind: "word", value: "delve" }] as const, shape: null };
    unwrap(recordVoiceBriefing({ brief, env, home, nowIso: NOW }));
    const path = voiceBriefReceiptPath({ home, session });
    const valid = readFileSync(path);
    const replacement = Buffer.from("�", "utf8");
    const at = valid.indexOf(replacement);
    writeFileSync(path, Buffer.concat([valid.subarray(0, at), Buffer.from([0xff]), valid.subarray(at + 3)]));

    expect(at).toBeGreaterThan(0);
    expect(admit({ env, home }).printed[0]).toContain("blocked because this visible session holds no receipt");
  });

  it("admits the same session once the refusal has briefed it", () => {
    const home = briefedHome();
    admit({ env: SESSION, home });

    expect(unwrap(admit({ env: SESSION, home }).result)).toBe(true);
  });

  it("refuses again once the owner's brief changes under the receipt", () => {
    const home = briefedHome();
    admit({ env: SESSION, home });
    writeProfile({ home, word: "utilise" });

    expect(admit({ env: SESSION, home }).printed).toContain('  - word (case-insensitive): "utilise"');
  });

  it("refuses a different session that holds no receipt of its own", () => {
    const home = briefedHome();
    admit({ env: SESSION, home });

    expect(admit({ env: { CODEX_THREAD_ID: "abc-123" }, home }).printed[0]).toContain(
      "blocked because this visible session holds no receipt",
    );
  });

  it("admits a process with no visible session, and refuses one naming two", () => {
    const home = briefedHome();

    expect(unwrap(admit({ env: {}, home }).result)).toBe(true);
    expect(unwrapErr(admit({ env: { ...SESSION, CODEX_THREAD_ID: "def-456" }, home }).result)[0]).toContain(
      "both a Claude Code session id and a Codex thread id are set",
    );
  });

  it("refuses with no receipt written when the owner's profile cannot be read", () => {
    const home = briefedHome();
    writeFileSync(join(home, "profile.json"), "{", "utf8");

    expect(unwrapErr(admit({ env: SESSION, home }).result)[0]).toContain(
      "the owner's voice brief could not be read, so nothing was parked or sent",
    );
  });
});

describe("recordVoiceBriefing", () => {
  it("writes the receipt that admitVoiceBriefing then accepts", () => {
    const home = briefedHome();
    const brief = { paragraphSpacing: false, rules: [{ kind: "word", value: "delve" }] as const, shape: null };

    expect(unwrap(recordVoiceBriefing({ brief, env: SESSION, home, nowIso: NOW }))).toBe("recorded");
    expect(unwrap(admit({ env: SESSION, home }).result)).toBe(true);
  });

  it("records nothing for a process with no visible session", () => {
    const home = briefedHome();
    const brief = { paragraphSpacing: false, rules: [{ kind: "word", value: "delve" }] as const, shape: null };

    expect(unwrap(recordVoiceBriefing({ brief, env: {}, home, nowIso: NOW }))).toBe("no-session");
  });
});
