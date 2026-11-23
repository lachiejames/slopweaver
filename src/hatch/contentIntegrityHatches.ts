/**
 * The escape-hatch rows for the integrity of content written to the owner's disk — a published page reaching a local
 * asset outside it, a write to a Claude auto-memory file, a hand edit rewording the owner's words on a relay row, and
 * a state push while a memory corpus defect stands.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new page or memory integrity refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on page and memory content integrity, in register order. */
export const CONTENT_INTEGRITY_HATCHES = [
  {
    caught:
      "the page names an image or stylesheet by a `file:` address, an absolute path or a path that climbs out of its own directory, and the console the owner opens it in serves only `$SLOPWEAVER_HOME/pages/<slug>/` — so the owner would see a broken image where the evidence was. Copy each file under the page's directory and link it relatively",
    command: "slopweaver page publish",
    exceptions: [
      "the page is archival HTML that deliberately preserves a dead absolute reference as the record of what was published",
      "the page is a diagnostic demonstrating the console's refusal of an outside reference",
    ],
    id: "page-external-local-asset",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_PAGE_EXTERNAL_LOCAL_ASSET" },
    // AMBIENT: it refuses a write to the owner's own disk, before anything is written, and sends nothing anywhere.
    lane: "ambient",
    reader: "src/pages/publish.ts",
    standing: "proposed",
  },
  {
    caught:
      "the page cites no review: every page the owner reacts to gets at least one Codex review pass before the owner sees it, because an inaccurate or incomplete briefing makes the owner steer off bad information. Prepare one with `slopweaver page review-prepare`, run the `codex review` it prints (or the Claude fallback when Codex is capped), and publish with `--review <id>`",
    command: "slopweaver page publish",
    exceptions: [
      "the page is archival HTML republished as the record of what was already published, not a briefing the owner reacts to",
      "the page is a diagnostic or fixture page nobody is meant to steer from, such as one demonstrating a console refusal",
    ],
    id: "unreviewed-page",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNREVIEWED_PAGE" },
    // AMBIENT: it refuses a write to the owner's own disk, before anything is written, and sends nothing anywhere.
    // A waived page still says so to the owner, in its own fold.
    lane: "ambient",
    reader: "src/cli/commands/page/publishRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "the memory it writes would not be readable by the thing that reads memories — a `name` outside the kebab identity grammar, or a `[[wikilink]]` whose target is not an identity any memory can ever carry (measured: 226 of 295 names carried a redundant type prefix and 166 were not kebab, and the dangling links were the consequence); or a memory whose subject overlaps another memory or an always-on canon section, left unanswered under `metadata.slopweaver.overlaps` (measured: three memories named reviewers, contradicted each other and canon, and nothing asked when any of them was written)",
    command: "a Write or Edit of a Claude auto-memory file",
    exceptions: [
      "the overlap names a canon section whose heading the same change renames, so no answer can name it until that canon lands",
      "you are renaming a memory INTO an identity an existing wikilink already uses, so the odd-looking name is the corrected target state rather than the defect",
      "you are reproducing a corpus defect deliberately, in order to test the checker that catches it",
    ],
    id: "memory-write",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_MEMORY_WRITE" },
    // AMBIENT: it refuses a local tool call over a file on this machine, and nothing leaves it — the same
    // reasoning the `artifact` and `python` rows above carry. The journalled lane is outbound-only and this
    // is not an outbound surface.
    lane: "ambient",
    reader: "src/admit/memoryWriteGuardRunner.ts",
    standing: "proposed",
  },
  {
    caught:
      "it would reword the owner's words on a talk relay row — the summary, the ownerWords quote, the heading, the paragraph under the first section heading or the running-list offer would no longer read what the relay turn holds, and the owner ruled a relay row keeps the owner's words and is never reworded (measured: 38 rows were reworded by plain Write calls and nothing refused). Edit any other field freely; `handover quote --apply` rewrites the quote from the turn",
    command: "a Write or Edit of a talk relay row on the board",
    exceptions: [
      "you are restoring a row whose relay carried a candidate ruling, which the turn file does not record, so the restored summary cannot be proved against its digest",
      "the owner asked, in the owner's own words, for this specific row's wording to change",
      "you are writing a throwaway row in a test home to prove this guard",
    ],
    id: "relay-words",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_RELAY_WORDS" },
    // AMBIENT: it refuses a local tool call over a file on this machine, and nothing leaves it — the same reasoning
    // as `memory-write` above. The journalled lane is outbound-only and this is not an outbound surface.
    lane: "ambient",
    reader: "src/admit/relayWordsGuardRunner.ts",
    standing: "proposed",
  },
  {
    caught:
      "an auto-memory corpus on this machine is carrying a standing defect, and this gate is the only thing between corpus reviews that says so out loud",
    command: "a push of the state repository while a memory corpus defect stands",
    exceptions: [
      "the finding is in a corpus belonging to a project you are not working on and cannot fix from here",
      "the defect is a transient half-written state another session is mid-way through resolving",
    ],
    id: "memory-corpus",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_MEMORY_CORPUS" },
    // AMBIENT: a local check over local files, gating a local git operation. Nothing leaves the machine, so
    // the outbound-only journalled lane does not apply.
    lane: "ambient",
    reader: "src/cli/commands/memory/gateRun.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
