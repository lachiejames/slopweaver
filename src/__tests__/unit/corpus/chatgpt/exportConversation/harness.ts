/*
 * What the export-conversation test files share: one conversation read out of the committed SYNTHETIC export, and a
 * one-message tree whose only message carries the content a case hands it. They moved here when the export
 * conversation tests were split one file per behaviour.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The committed synthetic export. */
const FIXTURE = join(import.meta.dirname, "../../../../fixtures/chatgpt/synthetic-export");

/**
 * One conversation of the fixture, by its file and position.
 *
 * @returns that conversation exactly as the export file holds it, unvalidated
 */
export function fixtureConversation({ file, index }: { file: string; index: number }): unknown {
  const all: unknown = JSON.parse(readFileSync(join(FIXTURE, file), "utf8"));
  if (!Array.isArray(all)) {
    throw new Error(`${file}: the synthetic export file is not an array of conversations`);
  }
  return all[index];
}

/**
 * A one-message tree whose only message carries `content`.
 *
 * @returns the conversation, a root and one assistant message addressed to all
 */
export function oneMessage({ content }: { content: Record<string, unknown> }): unknown {
  return {
    create_time: 1790000000,
    current_node: "m",
    id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5aff",
    mapping: {
      m: {
        id: "m",
        message: { author: { role: "assistant" }, content, create_time: 1790000001, id: "m", recipient: "all" },
        parent: "root",
      },
      root: { id: "root", message: null, parent: null },
    },
  };
}
