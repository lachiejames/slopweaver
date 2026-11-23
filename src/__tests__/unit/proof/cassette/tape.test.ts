import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { cassetteTape } from "../../../../proof/cassette/tape.js";

const OUT = "/Users/someone/.slopweaver/proof/1/demo.mp4";

const SOURCE = ["Set Shell bash", "Set Width 1100", 'Type "claude -p \\"summarise\\""', "Enter", "Wait", ""].join("\n");

/** The messages a refused tape printed, in order. */
function refusals({ source, out = OUT }: { source: string; out?: string }): readonly string[] {
  return unwrapErr(cassetteTape({ allowSlowTyping: false, out, source })).map((issue) => issue.message);
}

describe("cassetteTape", () => {
  it("types fast from the first line and writes the one .mp4 last", () => {
    const built = cassetteTape({ allowSlowTyping: false, out: OUT, source: SOURCE });
    expect(built.isOk()).toBe(true);
    expect(unwrap(built)).toBe(
      [
        "Set TypingSpeed 5ms",
        "Set Shell bash",
        "Set Width 1100",
        'Type "claude -p \\"summarise\\""',
        "Enter",
        "Wait",
        `Output "${OUT}"`,
        `Output "${OUT}.txt"`,
        "",
      ].join("\n"),
    );
  });

  it("keeps a tape's own faster typing, which a later Set overrides the default with", () => {
    expect(
      unwrap(cassetteTape({ allowSlowTyping: false, out: OUT, source: 'Set TypingSpeed 1ms\nType@2ms "x"' })),
    ).toContain("Set TypingSpeed 1ms\nType@2ms");
  });

  it("refuses VHS's own 50ms default spelled out, naming the line, as a slow-typing issue", () => {
    expect(
      unwrapErr(cassetteTape({ allowSlowTyping: false, out: OUT, source: "Set Shell bash\nSet TypingSpeed 50ms" })),
    ).toStrictEqual([
      {
        kind: "slow-typing",
        message:
          "line 2: types at 50ms a character — a cassette types at 10ms or faster, so a reader is not sat through it; " +
          "drop the setting and the cassette types at 5ms",
      },
    ]);
  });

  it("refuses a slow per-command Type@ override", () => {
    expect(refusals({ source: 'Type@100ms "slow"' })[0]).toContain("line 1: types at 100ms");
  });

  it("refuses a slow Type@ written with no space before its quote", () => {
    expect(refusals({ source: 'Type@500ms"x"' })[0]).toContain("line 1: types at 500ms");
    expect(refusals({ source: "Type@500ms'x'" })[0]).toContain("line 1: types at 500ms");
  });

  it("refuses a slow @-speed spaced either side of the @, and on a key command", () => {
    expect(refusals({ source: 'Type @500ms "x"\nType@ 500ms "y"\nBackspace@500ms 40\nCtrl+C@1s' })).toStrictEqual([
      expect.stringContaining("line 1: types at 500ms"),
      expect.stringContaining("line 2: types at 500ms"),
      expect.stringContaining("line 3: types at 500ms"),
      expect.stringContaining("line 4: types at 1s"),
    ]);
  });

  it("reads the tape as tokens, so a second command on a line and one split over two are both seen", () => {
    expect(refusals({ source: 'Sleep 100ms Type@500ms "x"' })).toStrictEqual([
      expect.stringContaining("line 1: types at 500ms"),
    ]);
    expect(refusals({ source: 'Type\n@500ms "x"\nSet TypingSpeed\n80ms' })).toStrictEqual([
      expect.stringContaining("line 2: types at 500ms"),
      expect.stringContaining("line 3: types at 80ms"),
    ]);
  });

  it("ends a string at its own quote, as VHS does with no escapes, so a command after it is read", () => {
    expect(refusals({ source: 'Type "a\\" Type@500ms "b"' })).toStrictEqual([
      expect.stringContaining("line 1: types at 500ms"),
    ]);
  });

  it("ends an unterminated string at its line break, so the next line's command is read", () => {
    expect(refusals({ source: 'Type "abc\nType@500ms "x"' })).toStrictEqual([
      expect.stringContaining("line 2: types at 500ms"),
    ]);
  });

  it("skips a comment, glued to a word or not, and a keyword inside a string", () => {
    expect(
      cassetteTape({
        allowSlowTyping: false,
        out: OUT,
        source: 'Type "c" # Type@500ms "e"\nType "f"#Set TypingSpeed 1s\nType "Output Source PlaybackSpeed 0.1"',
      }).isOk(),
    ).toBe(true);
  });

  it("refuses an @ followed by a string or by nothing as an unreadable duration", () => {
    expect(refusals({ source: 'Type@"x"' })).toStrictEqual(['line 1: cannot read the typing duration "x"']);
    expect(refusals({ source: "Enter@" })).toStrictEqual(['line 1: cannot read the typing duration ""']);
  });

  it("does not read an @ inside a typed string as a speed", () => {
    expect(cassetteTape({ allowSlowTyping: false, out: OUT, source: 'Type "mail me@500ms"' }).isOk()).toBe(true);
  });

  it("refuses a playback speed below real time as slow typing, and keeps one at or above it", () => {
    expect(
      unwrapErr(cassetteTape({ allowSlowTyping: false, out: OUT, source: "Set PlaybackSpeed 0.5" })),
    ).toStrictEqual([
      {
        kind: "slow-typing",
        message:
          "line 1: plays back at 0.5x — slower than real time stretches every keystroke past 10ms; drop the setting",
      },
    ]);
    expect(cassetteTape({ allowSlowTyping: false, out: OUT, source: "Set PlaybackSpeed 2" }).isOk()).toBe(true);
    expect(cassetteTape({ allowSlowTyping: true, out: OUT, source: "Set PlaybackSpeed 0.5" }).isOk()).toBe(true);
    expect(refusals({ source: "Set PlaybackSpeed slow" })).toStrictEqual([
      'line 1: cannot read the playback speed "slow"',
    ]);
  });

  it("lets slow typing through when the escape hatch is open, and nothing else", () => {
    expect(cassetteTape({ allowSlowTyping: true, out: OUT, source: 'Type@500ms"x"' }).isOk()).toBe(true);
    expect(
      unwrapErr(cassetteTape({ allowSlowTyping: true, out: OUT, source: 'Output "x.gif"\nSet TypingSpeed 80ms' })),
    ).toStrictEqual([
      {
        kind: "unrenderable",
        message:
          "line 1: the tape names its own output — drop it; the cassette writes the one --out .mp4, and VHS would " +
          "write this one too",
      },
    ]);
  });

  it("reads a bare duration as seconds and a seconds unit as seconds", () => {
    expect(refusals({ source: "Set TypingSpeed 0.05" })[0]).toContain("types at 0.05");
    expect(cassetteTape({ allowSlowTyping: false, out: OUT, source: "Set TypingSpeed 0.005s" }).isOk()).toBe(true);
  });

  it("refuses a duration it cannot read as unrenderable, which the hatch does not waive", () => {
    expect(unwrapErr(cassetteTape({ allowSlowTyping: true, out: OUT, source: "Set TypingSpeed fast" }))).toStrictEqual([
      { kind: "unrenderable", message: 'line 1: cannot read the typing duration "fast"' },
    ]);
  });

  it("refuses a tape naming its own output, since VHS would write that GIF too", () => {
    expect(refusals({ source: 'Output "demo.gif"\nType "x"' })[0]).toContain("line 1: the tape names its own output");
  });

  it("refuses a Source line it cannot see through", () => {
    expect(refusals({ source: "Source other.tape" })[0]).toContain("line 1: Source pulls in a tape");
  });

  it("refuses a GIF output, a relative one, and one a tape string cannot carry", () => {
    expect(refusals({ out: "/tmp/demo.gif", source: SOURCE })[0]).toContain("--out must be an .mp4");
    expect(refusals({ out: "demo.mp4", source: SOURCE })).toStrictEqual(["--out must be absolute, got demo.mp4"]);
    expect(refusals({ out: '/tmp/de"mo.mp4', source: SOURCE })).toStrictEqual([
      '--out cannot be written into a VHS tape: /tmp/de"mo.mp4',
    ]);
  });

  it("reports every refusal at once", () => {
    expect(refusals({ out: "/tmp/demo.gif", source: 'Output "x.gif"\nSet TypingSpeed 80ms' })).toHaveLength(3);
  });
});
