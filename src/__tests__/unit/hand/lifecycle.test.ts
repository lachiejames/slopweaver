/*
 * The note's own emitted lifecycle, run over an in-memory file table.
 */
import { describe, expect, it } from "vitest";

import { NO_KIND_ANSWERS } from "../../../hand/kindAnswers.js";
import { LIFECYCLE_JS } from "../../../hand/note/lifecycle.js";
import { CLOSED_BEAT, raiseToken } from "../../../hand/note/liveness.js";
import { handNotePanelSource } from "../../../hand/note/panel.js";
import type { HandStep } from "../../../hand/step.js";

const STEP: HandStep = {
  id: "gcloud-signin",
  postedBy: "session-1",
  postedIso: "2026-09-23T00:00:00.000Z",
  unblocks: "the deploy",
  what: "Sign in to Google Cloud",
  witness: "slopweaver hand done gcloud-signin",
};

/** The panel program for {@link STEP}, raised into slot 0 at the ordinary level. */
function panelSource(): string {
  return handNotePanelSource({
    beatPath: "/tmp/live/gcloud-signin.t.beat",
    consoleBase: "http://localhost:3000",
    kindAnswers: NO_KIND_ANSWERS,
    level: "ordinary",
    liveDir: "/tmp/live",
    markerDir: "/tmp/m",
    slot: 0,
    step: STEP,
    token: "t",
    triage: { commandsDir: "/tmp/triage/commands", statePath: "/tmp/triage/state.json" },
    wantPath: "/tmp/live/gcloud-signin.want",
  });
}

describe("LIFECYCLE_JS", () => {
  it("is embedded whole in the panel program, so the note runs exactly this source", () => {
    expect(panelSource()).toContain(LIFECYCLE_JS);
  });

  it("closes to a tombstone carrying CLOSED_BEAT, never to an absent beat a raise would read as starting", () => {
    expect(LIFECYCLE_JS).toContain(`var CLOSED_BEAT = '${CLOSED_BEAT}';`);
    expect(LIFECYCLE_JS).toContain(
      "nsstr(CLOSED_BEAT).writeToFileAtomicallyEncodingError(nsstr(STEP.beatPath), true, $.NSUTF8StringEncoding, null);",
    );
    expect(LIFECYCLE_JS).not.toContain("removeItemAtPathError(nsstr(STEP.beatPath)");
  });

  it("decides whether to draw before the window is ordered front, and closes only on its own step's files", () => {
    const source = panelSource();
    const drawn = source.indexOf("panel.orderFrontRegardless;");
    expect(drawn).toBeGreaterThan(0);
    expect(source.indexOf("if (!mayDraw()) { $.exit(0); }")).toBeLessThan(drawn);
    expect(source).toContain("  if (markerPresent()) { break; }");
    expect(source).toContain("  if (replacementDrawn()) { break; }");
  });

  it("reads no screen-wide file: a note of another step never moves this one", () => {
    expect(LIFECYCLE_JS).not.toContain("screen");
    expect(LIFECYCLE_JS).not.toContain("buildPath");
  });

  it("never writes a want file — raises alone do", () => {
    expect(LIFECYCLE_JS).not.toContain("nsstr(STEP.wantPath), true");
  });
});

/** One running note's lifecycle functions, evaluated over a shared in-memory file table. */
interface Note {
  readonly mayDraw: () => boolean;
  readonly beat: () => void;
  readonly stopBeating: () => void;
  readonly newerRaisePending: () => boolean;
  readonly replacementDrawn: () => boolean;
  readonly refreshBeat: () => void;
}

const LIVE = "/live";

/** The emitted program's `nsstr(value)`, which it calls positionally, over the in-memory file table. */
type Nsstr = (value: string) => {
  value: string;
  writeToFileAtomicallyEncodingError: (path: { value: string }) => void;
};

/** One file table's clock, in epoch seconds, and when each of its files was last written. */
const CLOCKS = new WeakMap<Map<string, string>, { now: number; written: Map<string, number> }>();

/** The clock `files` shares with every note over it, started at zero. */
function clockOf({ files }: { files: Map<string, string> }): { now: number; written: Map<string, number> } {
  const known = CLOCKS.get(files);
  if (known !== undefined) {
    return known;
  }
  const started = { now: 0, written: new Map<string, number>() };
  CLOCKS.set(files, started);
  return started;
}

/**
 * Evaluate LIFECYCLE_JS for one note against `files` — a plain stand-in for the four Foundation calls the
 * source makes (read a file, test one exists, write one atomically, sleep), so the protocol itself runs. A
 * sleep runs `whileAsleep`, which is where another process acts while this one waits.
 */
function note({
  files,
  id,
  token,
  build = "b1",
  whileAsleep = () => undefined,
}: {
  files: Map<string, string>;
  id: string;
  token: string;
  build?: string;
  whileAsleep?: () => void;
}): Note {
  const nsstr: Nsstr = (value) => ({
    value,
    writeToFileAtomicallyEncodingError: (path) => {
      files.set(path.value, value);
      clock.written.set(path.value, clock.now);
    },
  });
  const clock = clockOf({ files });
  const foundation = {
    NSDate: {
      get date(): { description: string; timeIntervalSince1970: number } {
        return { description: "now", timeIntervalSince1970: clock.now };
      },
    },
    NSThread: { sleepForTimeInterval: whileAsleep },
    NSFileManager: {
      defaultManager: {
        attributesOfItemAtPathError: (path: { value: string }) => {
          const at = clock.written.get(path.value);
          return at === undefined
            ? { isNil: () => true }
            : { fileModificationDate: { timeIntervalSince1970: at }, isNil: () => false };
        },
        contentsOfDirectoryAtPathError: (path: { value: string }) => ({
          isNil: () => false,
          js: [...files.keys()]
            .filter((key) => key.startsWith(`${path.value}/`))
            .map((key) => ({ js: key.slice(path.value.length + 1) })),
        }),
        fileExistsAtPath: (path: { value: string }) => files.has(path.value),
      },
    },
    NSString: {
      stringWithContentsOfFileEncodingError: (path: { value: string }) => {
        const text = files.get(path.value);
        return text === undefined ? { isNil: () => true, js: "" } : { isNil: () => false, js: text };
      },
    },
    NSUTF8StringEncoding: 4,
  };
  const step = {
    beatPath: `${LIVE}/${id}.${token}.beat`,
    build,
    id,
    liveDir: LIVE,
    markerDir: "/markers",
    token,
    wantPath: `${LIVE}/${id}.want`,
  };
  // oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text, as in panel.test.ts
  const load = new Function(
    "$",
    "nsstr",
    "STEP",
    `${LIFECYCLE_JS}\nreturn { mayDraw, beat, stopBeating, newerRaisePending, replacementDrawn, refreshBeat };`,
  ) as (...args: readonly unknown[]) => Note;
  return load(foundation, nsstr, step);
}

/** What a raise that means to draw writes before it launches: its step's want file, and nothing screen-wide. */
function raised({ files, id, token }: { files: Map<string, string>; id: string; token: string }): void {
  files.set(`${LIVE}/${id}.want`, token);
}

/** A note that may draw, drawn: it beats. */
function drew({ note: drawn }: { note: Note }): Note {
  expect(drawn.mayDraw()).toBe(true);
  drawn.beat();
  return drawn;
}

describe("notes of different steps stack, as each note's own program runs it", () => {
  it("three notes of three steps all draw and none closes another", () => {
    const files = new Map<string, string>();
    raised({ files, id: "a", token: "ta" });
    const a = drew({ note: note({ files, id: "a", token: "ta" }) });
    raised({ files, id: "b", token: "tb" });
    const b = drew({ note: note({ files, id: "b", token: "tb" }) });
    raised({ files, id: "c", token: "tc" });
    const c = drew({ note: note({ files, id: "c", token: "tc" }) });
    expect([a.replacementDrawn(), b.replacementDrawn(), c.replacementDrawn()]).toEqual([false, false, false]);
  });

  it("an older raise that reaches its first line after a newer raise of ANOTHER step still draws", () => {
    const files = new Map<string, string>();
    raised({ files, id: "a", token: "ta" });
    raised({ files, id: "b", token: "tb" });
    drew({ note: note({ files, id: "b", token: "tb" }) });
    expect(note({ files, id: "a", token: "ta" }).mayDraw()).toBe(true);
  });
});

describe("one note per step, as the note's own program runs it", () => {
  it("a note stays while its own step's newer raise is only wanted, and closes once that raise has drawn", () => {
    const files = new Map<string, string>();
    raised({ files, id: "a", token: "ta" });
    const first = drew({ note: note({ files, id: "a", token: "ta" }) });
    raised({ files, id: "a", token: "ta2" });
    expect(first.replacementDrawn()).toBe(false);
    drew({ note: note({ files, id: "a", token: "ta2", build: "b2" }) });
    expect(first.replacementDrawn()).toBe(true);
  });

  it("closes once a newer raise of its step drew, though a newer one still took the want file and failed", () => {
    // r3: the want file names only the newest raise, so the drawn second one was invisible to the first note.
    const [first, second, third] = [1, 2, 3].map((atMs) => raiseToken({ atMs, unique: "6f1c2b9e-0d4a" }));
    const files = new Map<string, string>();
    raised({ files, id: "a", token: first! });
    const one = drew({ note: note({ files, id: "a", token: first! }) });
    raised({ files, id: "a", token: second! });
    const two = drew({ note: note({ files, id: "a", token: second! }) });
    raised({ files, id: "a", token: third! });
    files.set(`${LIVE}/${third!}.failed`, "failed");
    expect([one.replacementDrawn(), two.replacementDrawn()]).toEqual([true, false]);
  });

  it("never reads a note of a step whose id merely starts with this one's", () => {
    const [first, second] = [1, 2].map((atMs) => raiseToken({ atMs, unique: "6f1c2b9e-0d4a" }));
    const files = new Map<string, string>();
    raised({ files, id: "a", token: first! });
    const a = drew({ note: note({ files, id: "a", token: first! }) });
    raised({ files, id: "a.b", token: second! });
    drew({ note: note({ files, id: "a.b", token: second! }) });
    expect(files.has(`${LIVE}/a.b.${second!}.beat`)).toBe(true);
    expect(a.replacementDrawn()).toBe(false);
  });

  it("a newer raise of its step that FAILED leaves the note standing", () => {
    const files = new Map<string, string>();
    raised({ files, id: "a", token: "ta" });
    const first = drew({ note: note({ files, id: "a", token: "ta" }) });
    raised({ files, id: "a", token: "ta2" });
    files.set(`${LIVE}/ta2.failed`, "failed");
    expect(first.replacementDrawn()).toBe(false);
  });

  it("a failure tombstone does not outrank a replacement that has drawn — the launcher can report late", () => {
    const files = new Map<string, string>();
    raised({ files, id: "a", token: "ta" });
    const first = drew({ note: note({ files, id: "a", token: "ta" }) });
    raised({ files, id: "a", token: "ta2" });
    drew({ note: note({ files, id: "a", token: "ta2" }) });
    files.set(`${LIVE}/ta2.failed`, "failed");
    expect(first.replacementDrawn()).toBe(true);
  });

  it("a replacement that drew and then CLOSED does not take this note down", () => {
    const files = new Map<string, string>();
    raised({ files, id: "a", token: "ta" });
    const first = drew({ note: note({ files, id: "a", token: "ta" }) });
    raised({ files, id: "a", token: "ta2" });
    drew({ note: note({ files, id: "a", token: "ta2" }) }).stopBeating();
    expect(first.replacementDrawn()).toBe(false);
  });

  it("a replacement whose beat has gone quiet past the window, or sits in the future, has not drawn", () => {
    const files = new Map<string, string>();
    raised({ files, id: "a", token: "ta" });
    const first = drew({ note: note({ files, id: "a", token: "ta" }) });
    raised({ files, id: "a", token: "ta2" });
    const clock = clockOf({ files });
    clock.now = 100;
    drew({ note: note({ files, id: "a", token: "ta2" }) });
    clock.now = 131;
    const quiet = first.replacementDrawn();
    clock.now = 50;
    expect([quiet, first.replacementDrawn()]).toEqual([false, false]);
  });

  it("a note raised a moment before a newer raise of its own step waits, then gives way once that one draws", () => {
    const files = new Map<string, string>();
    raised({ files, id: "a", token: "ta" });
    raised({ files, id: "a", token: "ta2" });
    const newer = note({ files, id: "a", token: "ta2" });
    const older = note({ files, id: "a", token: "ta", whileAsleep: () => drew({ note: newer }) });
    expect(older.newerRaisePending()).toBe(true);
    expect(older.mayDraw()).toBe(false);
  });

  it("a waiting note draws once its step's newer raise fails", () => {
    // Exiting at once left no note when the newer raise went on to fail.
    const files = new Map<string, string>();
    raised({ files, id: "a", token: "ta" });
    raised({ files, id: "a", token: "ta2" });
    let sleeps = 0;
    const older = note({
      files,
      id: "a",
      token: "ta",
      whileAsleep: () => {
        sleeps += 1;
        files.set(`${LIVE}/ta2.failed`, "failed");
      },
    });
    expect([older.mayDraw(), sleeps]).toEqual([true, 1]);
  });

  it("a waiting note outwaits a newer raise of its step that died before drawing", () => {
    // The newer panel launched and died, leaving no tombstone. After 30 s of 0.25 s waits —
    // STARTUP_WINDOW_MS, when every raise reads it as dead — the older note draws.
    const files = new Map<string, string>();
    raised({ files, id: "a", token: "ta" });
    raised({ files, id: "a", token: "ta2" });
    let sleeps = 0;
    const older = note({ files, id: "a", token: "ta", whileAsleep: () => (sleeps += 1) });
    expect([older.mayDraw(), sleeps]).toEqual([true, 120]);
  });

  it("rewrites its beat when the clock has gone back past the last write, so it never reads as dead", () => {
    const files = new Map<string, string>();
    raised({ files, id: "a", token: "ta" });
    const clock = clockOf({ files });
    clock.now = 100;
    const a = drew({ note: note({ files, id: "a", token: "ta" }) });
    clock.now = 50;
    a.refreshBeat();
    expect(clock.written.get(`${LIVE}/a.ta.beat`)).toBe(50);
  });
});
