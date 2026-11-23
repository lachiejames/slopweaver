import { describe, expect, it } from "vitest";

import { type SegmentJudge, shellWords, walkSegments } from "../../../admit/segmentWalk.js";

/** A judge that refuses `stop`, unless the segment's environment opened `ALLOW`, and records what it was shown. */
function recordingJudge(): { judge: SegmentJudge; seen: string[] } {
  const seen: string[] = [];
  const judge: SegmentJudge = ({ tokens, env }) => {
    seen.push(tokens.join(" "));
    if (tokens[0] === "stop" && env["ALLOW"] !== "1") {
      return { blocked: true, message: `refused ${tokens.join(" ")}` };
    }
    return { blocked: false };
  };
  return { judge, seen };
}

const run = ({ command, env = {} }: { command: string; env?: Record<string, string> }) => {
  const { judge, seen } = recordingJudge();
  return { seen, verdict: walkSegments({ command, env, judge, overrideEnv: "ALLOW" }) };
};

describe("walkSegments", () => {
  it("judges each segment with env prefixes and nohup/command/exec stripped off the front", () => {
    expect(run({ command: "X=1 nohup command exec go now; ok" }).seen).toEqual(["go now", "ok"]);
  });

  it("descends into an sh -c payload, a -lc cluster included, and returns the first refusal", () => {
    expect([
      run({ command: "bash -c 'stop here'" }).verdict,
      run({ command: 'zsh -lc "echo hi && stop there"' }).verdict,
    ]).toEqual([
      { blocked: true, message: "refused stop here" },
      { blocked: true, message: "refused stop there" },
    ]);
  });

  it("opens only the segment carrying the inline hatch, or every segment under the ambient one", () => {
    expect([
      run({ command: "ALLOW=1 stop a" }).verdict.blocked,
      run({ command: "ALLOW=1 true && stop b" }).verdict.blocked,
      run({ command: "stop c", env: { ALLOW: "1" } }).verdict.blocked,
    ]).toEqual([false, true, false]);
  });

  it("stops descending after three wrappers and judges the fourth as the shell itself", () => {
    // Each bare `sh` script word is what that shell runs; the whole-line reading is what descends.
    const { seen } = run({ command: "sh -c sh -c sh -c sh -c stop" });
    expect(seen).toEqual(["sh", "sh", "sh", "sh -c stop"]);
  });

  it("strips a quoted assignment holding a space whole, so the program is the next word", () => {
    expect(run({ command: "CLOUDSDK_CONFIG='/Users/x/My Config' stop now" }).verdict).toEqual({
      blocked: true,
      message: "refused stop now",
    });
  });

  it("walks with no hatch at all when none is named", () => {
    const { judge, seen } = recordingJudge();
    expect(walkSegments({ command: "ALLOW=1 stop a", env: {}, judge }).blocked).toBe(true);
    expect(seen).toEqual(["stop a"]);
  });

  it("reaches the script past an option after -c, and reads a $'…' script as its quoted text", () => {
    expect([
      run({ command: "sh -c -- 'stop here'" }).verdict,
      run({ command: "bash -c -x 'stop there' sh" }).verdict,
      run({ command: "bash -c $'stop now'" }).verdict,
    ]).toEqual([
      { blocked: true, message: "refused stop here" },
      { blocked: true, message: "refused stop there" },
      { blocked: true, message: "refused stop now" },
    ]);
  });

  it("decodes a $'…' script's escapes, whole or glued to a quoted run, the way bash runs it", () => {
    const script = recordingJudge();
    for (const command of ["bash -c $'\\x73top now'", "sh -c 'st'$'\\157p' x", "bash -c x$'\\x73top now'"]) {
      walkSegments({ command, env: {}, judge: script.judge, reading: "script" });
    }
    // The third is a DIFFERENT program, `xstop`: the decoded run joins the word in front of it.
    expect(script.seen).toEqual(["stop now", "stop", "xstop now"]);
  });

  it("walks the whole rest of the line beside the script by default, and only the script when asked", () => {
    const every = recordingJudge();
    const script = recordingJudge();
    walkSegments({ command: "sh -c 'go now' stop", env: {}, judge: every.judge });
    walkSegments({ command: "sh -c 'go now' stop", env: {}, judge: script.judge, reading: "script" });
    expect(every.seen).toEqual(["go now", "'go now' stop"]);
    expect(script.seen).toEqual(["go now"]);
  });
});

describe("shellWords", () => {
  it("splits on whitespace outside quotes and keeps the quotes and escapes on the words", () => {
    expect(shellWords({ text: `A='x y' B="p q" run a\\ b  'c d'` })).toEqual([
      "A='x y'",
      'B="p q"',
      "run",
      "a\\ b",
      "'c d'",
    ]);
  });

  it("reads a backslash inside single quotes as itself, as the shell does", () => {
    expect(shellWords({ text: "echo 'a\\' b" })).toEqual(["echo", "'a\\'", "b"]);
  });

  it("keeps a $'…' word whole to its unescaped close, so its \\' never swallows the words after it", () => {
    expect(shellWords({ text: "x=$'\\'' stop now" })).toEqual(["x=$'\\''", "stop", "now"]);
    expect(run({ command: "x=$'\\'' stop now" }).verdict).toEqual({ blocked: true, message: "refused stop now" });
  });

  it("answers no words for blank text", () => {
    expect(shellWords({ text: "  \n " })).toEqual([]);
  });
});
