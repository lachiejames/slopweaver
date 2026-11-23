/*
 * The recording verbs' gate (`src/handover/commandParagraphs.ts`) and the console's ask card (`site/lib/askCommands.ts`)
 * must lift the same commands out of the same question, or a question the gate passed draws a command as prose. In the
 * src lane because only it can read both; the site module is imported at run time, by address, because `src/`'s
 * `rootDir` may not contain a `site/` file (TS6059).
 */
import { describe, expect, it } from "vitest";

import { OWNER_PROGRAMS } from "../../../hand/runnableLiteral.js";
import { commandParagraphs } from "../../../handover/commandParagraphs.js";

const ASK_COMMANDS = new URL("../../../../site/lib/askCommands.ts", import.meta.url).href;

/** The site module's two exports, as this test reads them. */
interface SiteAskCommands {
  readonly ASK_COMMAND_PROGRAMS: readonly string[];
  readonly askCommands: (options: { text: string }) => { prose: string; commands: readonly string[] };
}

/**
 * Whether a module exposes the site's lift and its program list.
 *
 * @param module what the run-time import returned
 * @returns true when it carries both
 */
function isSiteAskCommands(module: unknown): module is SiteAskCommands {
  return typeof module === "object" && module !== null && "askCommands" in module && "ASK_COMMAND_PROGRAMS" in module;
}

/** Questions covering each branch of the criterion: lifted, the lead, a sentence, a mixed paragraph, two lines. */
const QUESTIONS: readonly string[] = [
  "Will you paste one sudo line?\n\nsudo /bin/sh -c '/bin/cp a b'\n\nIt keeps mds off.",
  "sudo reboot\n\nThen tell me.",
  "Will you run it?\n\nsudo is what the guard needs, once.",
  "Will you run it?\n\nsudo reboot\nIt takes a minute.",
  "Will you store both?\n\nslopweaver secrets set a-b-id\nslopweaver secrets set a-b-secret",
  "Will you sign in?\n\ngcloud auth login\n\nop signin --account atlas",
];

describe("the ask card's command lift mirrors the gate's", () => {
  it("lists the same programs the owner's commands run", async () => {
    const site: unknown = await import(ASK_COMMANDS);
    expect(isSiteAskCommands(site)).toBe(true);
    expect(OWNER_PROGRAMS.length).toBeGreaterThan(0);
    expect([...(site as SiteAskCommands).ASK_COMMAND_PROGRAMS].toSorted()).toEqual([...OWNER_PROGRAMS].toSorted());
  });

  it("lifts the same commands and leaves the same prose on every question", async () => {
    const site = (await import(ASK_COMMANDS)) as SiteAskCommands;
    expect(QUESTIONS.map((text) => site.askCommands({ text }))).toEqual(
      QUESTIONS.map((text) => commandParagraphs({ text })),
    );
    expect(commandParagraphs({ text: QUESTIONS[5]! }).commands).toEqual([
      "gcloud auth login",
      "op signin --account atlas",
    ]);
  });
});
