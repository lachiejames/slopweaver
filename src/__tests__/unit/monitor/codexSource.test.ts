import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCodexAuthStamp } from "../../../codex/signInAuthStamp.js";
import type { CodexSignInPort } from "../../../codex/signInPort.js";
import { unwrap } from "../../../lib/result.js";
import { readCodexPlanSignedOut } from "../../../monitor/codexSource.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryCodexSignInPort, unavailableCodexSignInPort } from "../../codexSignInFixture.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../planRegisterFixture.js";

import { firing, unmeasurable } from "./readings.js";

const READ_ISO = "2026-09-28T07:00:00.000Z";

let home = "";
/** The store the explicitly registered `codex-ambient` row names. */
let codexHome = "";
/** One store shared by the writer and the reader of a test, as one install's store is. */
let signInPort: CodexSignInPort = memoryCodexSignInPort();

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "monitor-codex-"));
  codexHome = join(home, "codex");
  // A plan comes only from the register, so the store is registered explicitly rather than discovered.
  const plansJson = stateHomePaths({ home }).plansJson;
  mkdirSync(dirname(plansJson), { recursive: true });
  writeFileSync(
    plansJson,
    JSON.stringify({ rows: [{ alias: "codex-ambient", provider: "codex", storeDir: codexHome }], version: 1 }),
    "utf8",
  );
  signInPort = memoryCodexSignInPort();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The labels the monitor reads for the one bootstrap store. */
async function labels(): Promise<readonly string[]> {
  return firing({
    reading: await readCodexPlanSignedOut({
      home,
      port: memoryPlanRegisterPort(),
      signInPort,
    }),
  }).subjects.map((subject) => subject.label);
}

/** Write the store's auth.json with the given text. */
function writeAuth({ text }: { text: string }): void {
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, "auth.json"), text);
}

/** File the live read's refusal of the store, against the auth.json on disk now. */
async function fileRefusal(): Promise<void> {
  const stamp = readCodexAuthStamp({ codexHome });
  unwrap(
    await signInPort.record({
      home,
      observed: [
        {
          alias: "codex-ambient",
          authAfter: stamp,
          authBefore: stamp,
          live: { codexHome, kind: "signed-out", readAtIso: READ_ISO },
        },
      ],
    }),
  );
}

describe("readCodexPlanSignedOut", () => {
  it("names a store directory that does not exist", async () => {
    expect(await labels()).toEqual(["its store directory does not exist"]);
  });

  it("tells an auth.json that does not parse apart from one with no sign-in in it", async () => {
    writeAuth({ text: "{not json" });
    const unparseable = await labels();
    writeAuth({ text: JSON.stringify({ auth_mode: "chatgpt" }) });
    expect([unparseable, await labels()]).toEqual([
      ["its auth.json does not parse"],
      ["its auth.json carries no sign-in"],
    ]);
  });

  it("fires on a live refusal of a store that looks signed in, until auth.json changes", async () => {
    writeAuth({ text: JSON.stringify({ tokens: { id: "stand-in" } }) });
    await fileRefusal();
    const refused = await labels();
    writeAuth({ text: JSON.stringify({ tokens: { id: "a fresh sign-in, longer" } }) });
    const after = await readCodexPlanSignedOut({
      home,
      port: memoryPlanRegisterPort(),
      signInPort,
    });
    expect([refused, after.state]).toEqual([[`the live read has refused its sign-in since ${READ_ISO}`], "clear"]);
  });

  it("is unmeasurable, never clear, over an import file that does not decode", async () => {
    writeAuth({ text: JSON.stringify({ tokens: { id: "stand-in" } }) });
    mkdirSync(join(home, "codex-signin"));
    writeFileSync(join(home, "codex-signin", "codex-ambient.json"), "[]");
    const reading = unmeasurable({
      reading: await readCodexPlanSignedOut({
        home,
        port: memoryPlanRegisterPort(),
        signInPort,
      }),
    });
    expect(reading.because).toBe(
      `sign-in record unreadable — codex-ambient: ${join(home, "codex-signin", "codex-ambient.json")} is not a JSON object`,
    );
  });

  it("is unmeasurable, never clear, when the register store cannot be read", async () => {
    writeAuth({ text: JSON.stringify({ tokens: { id: "stand-in" } }) });
    const reading = unmeasurable({
      reading: await readCodexPlanSignedOut({
        home,
        port: unavailablePlanRegisterPort(),
        signInPort,
      }),
    });
    expect(reading.because).toContain("the plan register could not be read: ");
    expect(reading.because).toContain("ECONNREFUSED");
  });

  it("is unmeasurable, never clear, when the sign-in observations cannot be read", async () => {
    writeAuth({ text: JSON.stringify({ tokens: { id: "stand-in" } }) });
    const reading = unmeasurable({
      reading: await readCodexPlanSignedOut({
        home,
        port: memoryPlanRegisterPort(),
        signInPort: unavailableCodexSignInPort(),
      }),
    });
    expect(reading.because).toContain("the Codex sign-in observations could not be read: ");
    expect(reading.because).toContain("ECONNREFUSED");
  });
});
