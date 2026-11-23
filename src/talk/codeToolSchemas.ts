/**
 * The three tools that give the console voice this checkout's tracked files: `code_find`, a literal search, `code_read`,
 * a bounded window of one file, and `code_list`, one directory. All three run `slopweaver talk code`. Each is `"read"`:
 * an untracked file is invisible to them, and `./fileToolSchemas.ts` is the reach past the checkout.
 */
import type { TalkTool } from "./talkToolSchemas.js";

/** The checkout's code tools, in the order both lists carry them, first of every tool. */
export const CODE_TOOLS: readonly TalkTool[] = [
  {
    description:
      "Search the tracked files of this checkout for a LITERAL string. Not a regular expression. Returns " +
      "matching files with line numbers and a short excerpt each, bounded by a total byte budget.",
    kind: "read",
    name: "code_find",
    runs: { noun: "talk", verb: "code" },
    summary: "search every tracked file of the Slopweaver checkout (code, docs/, skills/) for a literal string",
    parameters: {
      additionalProperties: false,
      properties: {
        maxHits: {
          description: "How many matching files to return at most.",
          maximum: 50,
          minimum: 1,
          type: "integer",
        },
        text: { description: "The literal string to look for.", type: "string" },
      },
      required: ["text"],
      type: "object",
    },
  },
  {
    description:
      "Read a window of one TRACKED file. Untracked files are invisible. One call carries about 10 KB; a " +
      "larger file comes back truncated with a `nextFrom` byte offset. Answer from the first window, and pass " +
      "`nextFrom` back as `from` only for what you still need. How a console page is derived — its order, how " +
      "a figure is counted, what a reading cannot see — is written under docs/console, never on the page.",
    kind: "read",
    name: "code_read",
    runs: { noun: "talk", verb: "code" },
    summary: "read one tracked file, e.g. docs/atlases.md or skills/supervisor/SKILL.md",
    parameters: {
      additionalProperties: false,
      properties: {
        from: {
          description: "Byte offset to resume at, from a previous call's nextFrom.",
          minimum: 0,
          type: "integer",
        },
        path: { description: "Repo-relative path, e.g. src/talk/checkout.ts", type: "string" },
      },
      required: ["path"],
      type: "object",
    },
  },
  {
    description: "List the tracked files under a directory of this checkout.",
    kind: "read",
    name: "code_list",
    runs: { noun: "talk", verb: "code" },
    summary: "list the tracked files under a directory",
    parameters: {
      additionalProperties: false,
      properties: {
        dir: { description: "Repo-relative directory; omit for the root.", type: "string" },
      },
      required: [],
      type: "object",
    },
  },
];
