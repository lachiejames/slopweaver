/*
 * `slack edit --as bot` over a turn CHECKLIST: re-drawn by the turn frame under the turnId the message carries,
 * through `updateTurn`, never the card renderer; and the checklist form's own bounds.
 */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { runEditChecklist } from "../../../../../cli/commands/slack/lifecycleRunEditChecklist.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import {
  type ChecklistEditForm,
  checklistEditFormSchema,
} from "../../../../../outbound/assistant/checklistEditForm.js";
import { SLACK_TURN_RENDERER } from "../../../../../outbound/assistant/turnMessage.js";
import type { SlackTurnPayload } from "../../../../../outbound/slack/types.js";
import { DEFAULT_TURN_METADATA_EVENT_TYPE } from "../../../../../profile.js";
import {
  editDeps,
  editOptions,
  editTransport,
  freshHome,
  ownMessage,
  type RecordedUpdate,
  TEST_CARD_TYPE,
} from "./editKindFakes.js";

const minted: string[] = [];
const homes = { fresh: (): string => freshHome({ dirs: minted }) };
afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const TS = "1700000000.000200";

const CHECKLIST: ChecklistEditForm = {
  kind: "checklist",
  modelId: "claude-opus-5-5",
  steps: [
    { id: "s1", state: "done", title: "Read the thread" },
    { id: "s2", state: "running", title: "Check the pool size" },
  ],
  task: "Why the staging pool exhausted",
};

const TURN_MESSAGE = ownMessage({
  eventType: DEFAULT_TURN_METADATA_EVENT_TYPE,
  extra: { turnId: "turn-abc" },
  renderer: SLACK_TURN_RENDERER,
  ts: TS,
});

describe("runEditChecklist", () => {
  it("re-draws a checklist in place through updateTurn, under the turnId the message already carries", async () => {
    const updates: RecordedUpdate[] = [];
    const out: string[] = [];
    const deps = editDeps({ out, transport: editTransport({ message: TURN_MESSAGE, updates }) });

    const code = await runEditChecklist({
      deps,
      form: CHECKLIST,
      options: editOptions({ home: homes.fresh(), ts: TS }),
    });

    expect(code).toBe(EXIT_OK);
    expect(updates.map(({ method, posted }) => ({ method, posted }))).toEqual([
      { method: "updateTurn", posted: { channel: "C0EDIT", ts: TS } },
    ]);
    const payload = updates[0]!.payload as SlackTurnPayload;
    expect(payload.metadata.event_type).toBe(DEFAULT_TURN_METADATA_EVENT_TYPE);
    expect(payload.metadata.event_payload).toEqual({
      renderer: SLACK_TURN_RENDERER,
      schemaVersion: 1,
      turnId: "turn-abc",
    });
    expect(JSON.stringify(payload.attachments)).toContain("Check the pool size");
    expect(out).toEqual([`edited — channel=C0EDIT ts=${TS} as a checklist`]);
  });

  it("prints the dry run and updates nothing", async () => {
    const updates: RecordedUpdate[] = [];
    const out: string[] = [];
    const deps = editDeps({ out, transport: editTransport({ message: TURN_MESSAGE, updates }) });

    const options = editOptions({ dryRun: true, home: homes.fresh(), ts: TS });
    expect(await runEditChecklist({ deps, form: CHECKLIST, options })).toBe(EXIT_OK);
    expect(updates).toEqual([]);
    expect(out).toEqual([
      `dry run — nothing was changed. would chat.update C0EDIT/${TS} as a CHECKLIST`,
      "  steps: 2, turn id inherited: turn-abc",
    ]);
  });

  it("refuses a checklist carrying no turnId rather than minting one, updating nothing", async () => {
    const updates: RecordedUpdate[] = [];
    const message = ownMessage({ eventType: DEFAULT_TURN_METADATA_EVENT_TYPE, renderer: SLACK_TURN_RENDERER, ts: TS });
    const deps = editDeps({ out: [], transport: editTransport({ message, updates }) });

    const code = await runEditChecklist({
      deps,
      form: CHECKLIST,
      options: editOptions({ home: homes.fresh(), ts: TS }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(updates).toEqual([]);
  });

  it("refuses a checklist form aimed at a card, updating nothing", async () => {
    const updates: RecordedUpdate[] = [];
    const message = ownMessage({ eventType: TEST_CARD_TYPE, renderer: "slack-card-v1", ts: TS });
    const deps = editDeps({ out: [], transport: editTransport({ message, updates }) });

    const code = await runEditChecklist({
      deps,
      form: CHECKLIST,
      options: editOptions({ home: homes.fresh(), ts: TS }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(updates).toEqual([]);
  });
});

describe("checklistEditFormSchema", () => {
  const step = { id: "s1", state: "pending", title: "A step" };

  it("accepts a form inside every bound", () => {
    expect(checklistEditFormSchema.safeParse({ ...CHECKLIST }).success).toBe(true);
  });

  it.each([
    { form: { ...CHECKLIST, turnId: "turn-other" }, fragment: "turnId", name: "a caller-supplied turnId" },
    {
      form: { ...CHECKLIST, steps: [{ ...step, title: "two\nlines" }] },
      fragment: "one line only",
      name: "a line break in a step",
    },
    { form: { ...CHECKLIST, steps: [step, { ...step }] }, fragment: "must be unique", name: "a duplicated step id" },
    {
      form: { ...CHECKLIST, steps: Array.from({ length: 8 }, (_, index) => ({ ...step, id: `s${String(index)}` })) },
      fragment: "at most 7 outline steps",
      name: "eight outline steps",
    },
    { form: { ...CHECKLIST, steps: [] }, fragment: '"path":["steps"]', name: "no steps" },
  ])("refuses $name, naming why", ({ form, fragment }) => {
    const parsed = checklistEditFormSchema.safeParse(form);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error!.issues)).toContain(fragment);
  });
});
