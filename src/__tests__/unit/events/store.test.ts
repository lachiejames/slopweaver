import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ListenerStreamEvent, RecipeStreamEvent } from "../../../events/event.js";
import {
  appendSupervisorEvent,
  publishSupervisorEvent,
  readSupervisorEventsFrom,
  readSupervisorEventsTail,
  supervisorStreamPath,
} from "../../../events/store.js";
import { unwrap } from "../../../lib/result.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const home = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-events-"));
  fixtureDirs.push(dir);
  return dir;
};

const listener = (over: Partial<ListenerStreamEvent> = {}): ListenerStreamEvent => ({
  armId: "a1b2c3d4",
  atIso: "2026-08-23T03:00:00.000Z",
  kind: "armed",
  pid: 4242,
  source: "listener",
  why: "the Slack listener is up",
  ...over,
});

const recipe = (over: Partial<RecipeStreamEvent> = {}): RecipeStreamEvent => ({
  atIso: "2026-08-23T03:01:00.000Z",
  kind: "completed",
  runId: "run-9",
  slotHash: "slot-7",
  source: "recipe-scheduler",
  why: "a recipe slot completed",
  ...over,
});

describe("reading a home that has never published", () => {
  it("is an empty read at offset zero, not a fault", () => {
    const read = unwrap(readSupervisorEventsFrom({ home: home() }));
    expect(read.entries).toStrictEqual([]);
    expect(read.offset).toBe(0);
    expect(read.gap).toBe(false);
  });
});

describe("append then read", () => {
  it("reads back both events in file order", () => {
    const dir = home();
    expect(unwrap(appendSupervisorEvent({ event: listener(), home: dir }))).toBe(undefined);
    unwrap(appendSupervisorEvent({ event: recipe(), home: dir }));
    const read = unwrap(readSupervisorEventsFrom({ home: dir }));
    expect(read.entries.map((entry) => entry.event)).toStrictEqual([listener(), recipe()]);
  });

  it("reports the offset just past the last complete line", () => {
    const dir = home();
    unwrap(appendSupervisorEvent({ event: listener(), home: dir }));
    const read = unwrap(readSupervisorEventsFrom({ home: dir }));
    expect(read.offset).toBe(Buffer.byteLength(`${JSON.stringify(listener())}\n`, "utf8"));
  });

  it("gives each entry the offset a reader that consumed it resumes at", () => {
    const dir = home();
    unwrap(appendSupervisorEvent({ event: listener(), home: dir }));
    unwrap(appendSupervisorEvent({ event: recipe(), home: dir }));
    const read = unwrap(readSupervisorEventsFrom({ home: dir }));
    expect(read.entries[0]!.endOffset).toBe(Buffer.byteLength(`${JSON.stringify(listener())}\n`, "utf8"));
    expect(read.entries[1]!.endOffset).toBe(read.offset);
  });

  it("reads nothing new from the offset the previous read stopped at", () => {
    const dir = home();
    unwrap(appendSupervisorEvent({ event: listener(), home: dir }));
    const first = unwrap(readSupervisorEventsFrom({ home: dir }));
    const second = unwrap(readSupervisorEventsFrom({ fromOffset: first.offset, home: dir }));
    expect(second.entries).toStrictEqual([]);
    expect(second.offset).toBe(first.offset);
  });

  it("reads only what arrived after the recorded offset", () => {
    const dir = home();
    unwrap(appendSupervisorEvent({ event: listener(), home: dir }));
    const first = unwrap(readSupervisorEventsFrom({ home: dir }));
    unwrap(appendSupervisorEvent({ event: recipe(), home: dir }));
    const second = unwrap(readSupervisorEventsFrom({ fromOffset: first.offset, home: dir }));
    expect(second.entries.map((entry) => entry.event)).toStrictEqual([recipe()]);
  });
});

describe("a record still being written", () => {
  it("leaves a trailing partial line unconsumed rather than parsing half of it", () => {
    const dir = home();
    unwrap(appendSupervisorEvent({ event: listener(), home: dir }));
    const complete = unwrap(readSupervisorEventsFrom({ home: dir })).offset;
    appendFileSync(supervisorStreamPath({ home: dir }), '{"source":"listener","kind":"di');
    const read = unwrap(readSupervisorEventsFrom({ home: dir }));
    expect(read.entries.map((entry) => entry.event)).toStrictEqual([listener()]);
    expect(read.offset).toBe(complete);
  });

  it("consumes that same record once its line is finished", () => {
    const dir = home();
    const path = supervisorStreamPath({ home: dir });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(listener())}\n`);
    const first = unwrap(readSupervisorEventsFrom({ home: dir }));
    appendFileSync(path, JSON.stringify(recipe()));
    expect(unwrap(readSupervisorEventsFrom({ fromOffset: first.offset, home: dir })).entries).toStrictEqual([]);
    appendFileSync(path, "\n");
    const third = unwrap(readSupervisorEventsFrom({ fromOffset: first.offset, home: dir }));
    expect(third.entries.map((entry) => entry.event)).toStrictEqual([recipe()]);
  });
});

describe("a stream that shrank under its reader", () => {
  it("reports a gap and restarts from the beginning of the file", () => {
    const dir = home();
    const path = supervisorStreamPath({ home: dir });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(listener())}\n${JSON.stringify(recipe())}\n`);
    const stale = unwrap(readSupervisorEventsFrom({ home: dir })).offset;
    writeFileSync(path, `${JSON.stringify(listener({ kind: "died", why: "the listener DIED" }))}\n`);
    const read = unwrap(readSupervisorEventsFrom({ fromOffset: stale, home: dir }));
    expect(read.gap).toBe(true);
    expect(read.entries.map((entry) => entry.event.kind)).toStrictEqual(["died"]);
  });

  it("reports no gap when the offset is exactly the end of the file", () => {
    const dir = home();
    unwrap(appendSupervisorEvent({ event: listener(), home: dir }));
    const read = unwrap(readSupervisorEventsFrom({ home: dir }));
    expect(unwrap(readSupervisorEventsFrom({ fromOffset: read.offset, home: dir })).gap).toBe(false);
  });
});

describe("a line that will not decode", () => {
  it("is counted and dropped, and never blinds the reader to the rest", () => {
    const dir = home();
    const path = supervisorStreamPath({ home: dir });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `{"torn":true}\n${JSON.stringify(recipe())}\n`);
    const read = unwrap(readSupervisorEventsFrom({ home: dir }));
    expect(read.unreadable).toBe(1);
    expect(read.entries.map((entry) => entry.event)).toStrictEqual([recipe()]);
  });
});

describe("the bounded tail", () => {
  it("is empty for a home that has never published", () => {
    expect(unwrap(readSupervisorEventsTail({ home: home() }))).toStrictEqual([]);
  });

  it("returns the newest events without reading the whole file", () => {
    const dir = home();
    for (let index = 0; index < 40; index += 1) {
      unwrap(appendSupervisorEvent({ event: listener({ why: `beat ${String(index)}` }), home: dir }));
    }
    const tail = unwrap(readSupervisorEventsTail({ home: dir, maxBytes: 400 }));
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.at(-1)!.why).toBe("beat 39");
    expect(tail.length < 40).toBe(true);
  });
});

describe("publishing without sinking the caller", () => {
  it("returns undefined when the append succeeded", () => {
    expect(publishSupervisorEvent({ event: listener(), home: home() })).toBe(undefined);
  });

  it("returns the reason as a sentence when the stream path cannot be written", () => {
    const dir = home();
    // A FILE where the stream's directory must be: `mkdirSync` fails, so the append cannot happen.
    writeFileSync(join(dir, "live"), "not a directory");
    const failure = publishSupervisorEvent({ event: listener(), home: dir });
    expect(failure?.includes("could not append to the supervisor stream")).toBe(true);
  });
});
