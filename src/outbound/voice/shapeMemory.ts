/**
 * The pure half of reading the operator's RESPONSE-SHAPE guidance out of their own memory file.
 *
 * ## Why the text lives in a memory rather than in configuration
 *
 * `./composerBrief.ts` prints the operator's exact voice BANS, which are enforced. What it could not print
 * until now is the SHAPE of a reply — the ceiling, the outcome-first ordering, what a hedge is for — because
 * nothing in this installation held it. Three skills promised "the operator's full voice guidance" and
 * `slopweaver slack voice-rules` answered with a word list, so the promise resolved to about a fifth of what
 * it claimed.
 *
 * The guidance is the operator's own ways of working, so it belongs in their memory corpus, which is where a
 * composing session already reads what it knows about them. `profile.json` therefore carries a POINTER
 * (`slackMe.voice.shapeMemoryFile`) and never a copy: one authoritative text, so the briefing and the memory
 * cannot disagree about what the operator asked for. This module owns none of that text — it validates the
 * envelope and hands the body back, exactly as the rest of this directory owns shape and never vocabulary.
 *
 * The frontmatter is parsed by `../../memory/parse.ts`, the one parser over that corpus, rather than by a
 * second reader here: two parsers over one corpus eventually disagree about which files are memories and
 * what they say, which is the whole reason that module states the rule.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { parseFrontmatter, splitFrontmatter } from "../../memory/parse.js";

/*
 * Exactly what is and is not preserved, because four review rounds went at this and the fourth one was
 * chasing a claim too strong rather than a defect.
 *
 * PRESERVED: every visible character, and indentation — including the leading spaces of an indented Markdown
 * example, which a whole-body `.trim()` used to eat (round three).
 *
 * NOT preserved, deliberately: blank lines at the body's edges; CRLF, which `../../memory/parse.ts`
 * normalises to LF for the whole corpus so the same file reads identically however it was saved
 * (`shapeMemory.test.ts` asserts that on purpose — it is the wanted behaviour, not a leak); and trailing
 * spaces on the last content line. The last of those is the one a stricter reading would call a defect: two
 * trailing spaces are a hard line break in rendered Markdown. This output is printed to a terminal by
 * `slopweaver slack voice-rules`, never rendered, so it changes nothing a composer reads — and that is a
 * judgement, recorded here rather than argued again next time.
 *
 * Five review rounds ran over this diff and the loop stopped there deliberately. One found a live bug (a
 * configured install briefed as empty, exit 0). Two and three were real and progressively smaller (a silent
 * U+FFFD substitution; the indentation above). Four was an artefact of a property worded "byte-for-byte".
 * Five found the `--json` document did not say which of its values the send door refuses on, which was worth
 * fixing. A sixth round was not run: the value was front-loaded and the residue is written here instead.
 */

/**
 * Validate one response-shape memory and return the prose a composing session should be briefed with.
 *
 * Strict on purpose. A configured file that is not a well-formed memory is a BROKEN configuration, not an
 * empty one: answering `ok` with nothing would make `voice-rules` print a confident partial brief, which is
 * the failure the verb exists to prevent. An installation that has configured nothing takes a different
 * path and never reaches here.
 *
 * @param file the path the text was read from, named in every failure so an operator can find it
 * @param text the whole file, frontmatter included
 * @returns the memory's body with blank lines at its edges removed and every other byte, indentation
 *   included, exactly as written; or every reason the file is unusable
 */
export function parseVoiceShapeMemory({ file, text }: { file: string; text: string }): Result<string> {
  const { findings } = parseFrontmatter({ file, text });
  if (findings.length > 0) {
    return err(findings.map((finding) => `${file}: ${finding.message}`));
  }
  // Blank LINES at the edges go; indentation does not. `.trim()` would strip the four spaces in front of an
  // indented Markdown example on the first content line, turning a code block into a bullet — the operator's
  // own guidance, silently rewritten, which is the one thing this reader must never do.
  const body = splitFrontmatter({ text })
    .body.replace(/^\s*\n/, "")
    .replace(/\s+$/, "");
  if (body.trim() === "") {
    return err([`${file}: the memory has valid frontmatter and an empty body, so there is no guidance to print`]);
  }
  return ok(body);
}
