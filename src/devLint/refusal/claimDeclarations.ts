/**
 * The claim gates' refusal copy — the part of the declaration table that belongs to the instruments judging
 * a statement the repository makes about itself: documents, links and counts, app copy, command and skill
 * metadata, naming, the registers and the atlas listings.
 *
 * A gate lives here when what it reads is prose, a register row or a listing that a reader will take as
 * true. A gate that judges the shape of source is in `./sourceShapeDeclarations.ts`, and one that judges what
 * code reaches is in `./reachDeclarations.ts`.
 *
 * Every refusal id of a gate lives in the same leaf — a gate's fresh-violation row and its debt or rebaseline
 * row move together — which `registryComposition.test.ts` holds down. A new row goes here when its gate is a
 * claim one, and this file splits again when it nears the 300-code-line cap.
 */
import type { LintGateDeclaration } from "./types.js";

/**
 * The claim rows, keyed by refusal id. Spread into `./declarations.ts`'s `LINT_GATE_DECLARATIONS`, which
 * stays the one table every consumer reads.
 */
export const CLAIM_LINT_GATE_DECLARATIONS = {
  "agent-doc-size": {
    caught:
      "a tracked markdown document is over its cap — 200 raw lines for agent-facing instructions, 300 for every other .md — so a reader pays for context it will not read",
    correction:
      "keep the rule, the decision or the topic index in the parent and move the detail into linked child pages, each with one owner",
    exceptions: [
      "a document that is already under the cap and is only being moved",
      "untracked or generated markdown, which the tracked-file policy never sees",
    ],
    gate: "agent-doc-size",
  },
  "agent-doc-size-rebaseline": {
    caught:
      "a rebaseline was asked to record a document GROWING, which would move the bar rather than measure against it",
    correction:
      "shrink the document to at or under its recorded size, then rebaseline; a baseline only ever ratchets down",
    exceptions: ["a genuine, reviewed decision to raise a cap, which changes the cap rather than the baseline"],
    gate: "agent-doc-size",
  },
  "atlas-content-coverage-platform": {
    caught: "a platform the atlas lists resolves to no registry, so the listing promises a surface nothing can answer",
    correction: "register the platform's reader, or drop it from the platform list until one exists",
    exceptions: ["a platform deliberately listed as unavailable, declared with that stated"],
    gate: "atlas-content-coverage",
  },
  "atlas-content-coverage": {
    caught:
      "the recorded atlas-content debt no longer matches the scan — a kind nothing fills, a count that moved, or a reach that rose above its floor",
    correction:
      "make the change each line above names — fill the kind, or move the recorded debt to the value that line states, in the same change",
    exceptions: ["a kind whose provider genuinely returns nothing today, declared with that stated"],
    gate: "atlas-content-coverage",
  },
  "atlas-manifest-clock": {
    caught:
      "a module outside the atlas kit stamps a manifest clock of its own, so a generation can claim a time the kit never derived",
    correction:
      "let the kit derive the generation's instant from the kind files it vouches for, as it derives every digest",
    exceptions: ["a function inside the atlas kit itself, which is where the stamping legitimately lives"],
    gate: "atlas-manifest-clock",
  },
  "command-meta-residue": {
    caught:
      "a command module restates metadata its manifest already declares, so the two can disagree with nothing to notice",
    correction:
      "delete the duplicate and read the manifest's field, which is the one a reader and the catalog both see",
    exceptions: ["a field the manifest genuinely does not carry"],
    gate: "command-meta-residue",
  },
  "command-trigger": {
    caught: "a skill's front matter cannot be used by the skill listing, so the skill is shipped and undiscoverable",
    correction: "give the skill the trigger fields the listing reads, in the shape the other skills use",
    exceptions: ["a skill deliberately excluded from the listing, marked as such"],
    gate: "command-trigger",
  },
  "doc-links": {
    caught:
      "a local link in a tracked markdown file, or a repo-rooted doc reference in source, names no tracked file or no heading or explicit anchor in it, so a reader following it lands nowhere",
    correction:
      "repoint the path or fragment at where the detail now lives, in the same change that moved or renamed it",
    exceptions: [
      "an external URL, which an offline lint lane never fetches",
      "a line anchor on a non-markdown file, which only GitHub's renderer resolves",
    ],
    gate: "doc-links",
  },
  "doc-links-tree": {
    caught:
      "a page under docs/ or a skill's reference/ is reachable from no readme, instruction file, rule or skill body by following links, so no reader will ever arrive at it",
    correction:
      "link the page from the index or skill body that owns its topic, or fold its unique content into that owner and delete it",
    exceptions: [
      "a fixture, template or dated artifact outside docs/ and reference/, which is data rather than navigation",
    ],
    gate: "doc-links",
  },
  "doc-counts": {
    caught:
      "a document read as INSTRUCTIONS hard-codes a count, which goes stale silently and lies to the next session",
    correction: "state the command that reproduces the number instead of the number, or drop the count",
    exceptions: [
      "a dated write-up of something that happened, which does not go stale",
      "a count that drives a constant rather than prose",
    ],
    gate: "doc-counts",
  },
  "console-loading-prose": {
    caught:
      "a console page tells the reader it is still reading or loading in words ending in an ellipsis, and the owner ruled that a page waiting on data shows a progress indicator, never text",
    correction:
      "draw `Spinner` or `SpinnerBlock` from `site/components/ui/spinner.tsx` in that place, with the words as its `label`, and keep a read that failed as its own visible sentence",
    exceptions: [
      "the label of a control the reader pressed while it acts, such as a button reading Sending…, which uses no read or load word",
    ],
    gate: "console-loading-prose",
  },
  "forbidden-identifiers": {
    caught:
      "a file carries a forbidden person, organisation or product token, a real provider id, a team key or a non-synthetic provider workspace location, which the repository must not ship",
    correction:
      "replace the identifier with its synthetic stand-in — a generic role or product word, an id spelled with `FIXTURE` or `0SYN`, a workspace from the location rule's allowed list — and run the gate with `--list` to see every file and line",
    exceptions: [
      "a synthetic workspace label the location rule does not list yet, which goes in that rule's `allowed` set in `src/hygiene/providerLocations.ts`",
      "a rule that is wrong, which is regenerated from its out-of-repository source rather than hand-edited",
    ],
    gate: "forbidden-identifiers",
  },
  "legacy-vocabulary": {
    caught:
      "a name declared in this repository calls a first-party construct legacy, and the owner ruled that the current way is written as the way it was always intended",
    correction:
      "delete the construct if nothing produces it, or rename it for what it actually is; a wire byte another writer chose is spelled in value position at the decoder",
    exceptions: [
      "Cloudflare's product name Legacy WAF, which the criterion reads as the product",
      "a generated provider boundary, whose wire keys a generator transcribed from the provider's own schema",
      "prose in a comment, which this gate does not read at all",
    ],
    gate: "legacy-vocabulary",
  },
  "manifest-loader-tests-unresolved": {
    caught:
      "an advertised verb's handler does not resolve, so help describes and the catalog lists a dispatch that would crash",
    correction: "export the handler the manifest names, or remove the verb from the manifest until it exists",
    exceptions: ["a verb deliberately hidden from the catalog, which is not advertised at all"],
    gate: "manifest-loader-tests",
  },
  "manifest-loader-tests": {
    caught:
      "a command module the CLI can dispatch is imported by no unit test, so shipped-but-wired-to-nothing is invisible to the suite",
    correction: "add a unit test that imports the module and exercises its runner against injected seams",
    exceptions: ["a module that is not a manifest loader target at all"],
    gate: "manifest-loader-tests",
  },
  "naming-doctrine": {
    caught:
      "found one concept named two ways — a CLI noun and a skill, or two of either, differing only by separators, a plural or an abbreviation, or a sidebar page whose address, key and label disagree — and the owner ruled one consistent name per concept",
    correction:
      "rename every surface to the one name the concept carries, canon included, in one pull request; when the two really are distinct concepts, rename one so the names stop reading as the same thing",
    exceptions: [
      "two genuinely different concepts whose names happen to relate, which a rename of one should make obvious",
      "a divergence measured before the rule existed, recorded in the shrinking debt register with its canonical name",
    ],
    gate: "naming-doctrine",
  },
  "naming-doctrine-debt": {
    caught:
      "a recorded naming divergence stopped firing, so the debt register now describes something that is no longer there",
    correction: "remove the row from the debt register in the same pull request as the rename that cleared it",
    exceptions: ["a row that still fires, which is the register doing its job"],
    gate: "naming-doctrine",
  },
  "naming-vocabulary": {
    caught:
      "found a type, interface, class, enum, exported binding or typed field whose name carries provider, platform or connector as a whole segment, words the owner retired from our own vocabulary",
    correction:
      "name it with the integration glossary in docs/doctrine-rationale/rule-11.md (integration, model host, token minter, OS, integration state); when the field mirrors another system's wire key, quote its name so the wire rule reads it as theirs",
    exceptions: [
      "a field that really is another system's JSON key, written quoted",
      "a declaration measured before the rule existed, recorded in the shrinking naming-vocabulary baseline",
    ],
    gate: "naming-doctrine",
  },
  "naming-vocabulary-debt": {
    caught:
      "a naming-vocabulary baseline row records more declarations than the tree still holds, so the register describes something that is no longer there",
    correction:
      "after the rename, rewrite the register with `yarn tsx src/devLint/namingDoctrine.entry.ts --rebaseline` in the same pull request",
    exceptions: ["a row whose count still matches the tree, which is the register doing its job"],
    gate: "naming-doctrine",
  },
  "app-copy-voice": {
    caught:
      "a string the app itself writes carries an em dash or an en dash, which is a voice rule violation on anything shown inside the app",
    correction:
      "write two sentences, or a comma, or put each clause on its own line; text somebody else wrote arrives as data and is never a literal here",
    exceptions: [
      "a file already on the debt list at its recorded count, which only ratchets down",
      "a dash a detector needs to match, which belongs in a regular expression rather than a string",
    ],
    gate: "app-copy-voice",
  },
  "app-copy-voice-rebaseline": {
    caught: "a rebaseline was asked to record MORE dashed literals in a file than its debt entry carries",
    correction: "take the new dashes out, then rebaseline; the debt list only ratchets down",
    exceptions: ["a file whose first entry is being added, which widens the list rather than an entry"],
    gate: "app-copy-voice",
  },
  "transient-references": {
    caught:
      "a file carries more references of one class than its debt entry allows — a dated ruling, a commit, pull request, turn, call or session id, a time of day, an attributed quote, a masculine pronoun for the owner, or an id into one installation's state (a knowledge row, a talk, call, transcript or session pointer, a voice turn, a handover run cited as provenance) — and none of them means anything in another checkout",
    correction:
      'state the rule and its reason in the present tense: a measurement keeps its number and repro command and loses its date, hash and the row or run that recorded it; write "the owner", then they; a fixture value that is a real installation id becomes a reserved synthetic one (l-0000000000000001, turn_000000000000000000001, a UUID whose second group is 0000)',
    exceptions: [
      "a file already on the debt list at its recorded count, which only ratchets down",
      "data a test feeds the code under test, which belongs in a fixture string rather than a comment or a test name",
      "a pattern that recognises how any speaker talks, which belongs in a regular expression rather than a string",
    ],
    gate: "transient-references",
  },
  "transient-references-rebaseline": {
    caught: "a rebaseline was asked to record MORE references of a class in a file than its debt entry carries",
    correction: "rewrite the new ones as the rule and its reason, then rebaseline; the debt list only ratchets down",
    exceptions: ["a file or class whose first entry is being added, which widens the list rather than an entry"],
    gate: "transient-references",
  },
  "transient-references-slack": {
    caught:
      "a debt entry records more references of a class than its file now holds, which leaves room for new ones to pass unseen",
    correction:
      "run yarn devlint:transient-references-rebaseline and commit the tightened list with the rewrite that lowered it",
    exceptions: ["none: a decrease is committed in the change that made it, so the list always matches the tree"],
    gate: "transient-references",
  },
  "authored-separator": {
    caught: "a card's TL;DR is built from a string carrying a separator character somebody typed",
    correction:
      "take the two ideas as two fields and let the headline form join them, or — where the line quotes somebody else's words and cannot take that form — write two sentences",
    exceptions: ["a separator a renderer supplies from a named constant, which is the pattern this generalises"],
    gate: "authored-separator",
  },
  "host-wording": {
    caught:
      "a line this change adds names the machine Slopweaver runs on by its make, a wording the attribution rule retired",
    correction: 'write "this machine"; macOS, Keychain, Spotlight and APFS are product names and stay',
    exceptions: [
      "the phrase named as itself, wrapped exactly in quotes or backticks, which documents the rule rather than breaking it",
      "a line under a __tests__ tree, whose fixtures feed the publication scan the phrase it refuses",
    ],
    gate: "host-wording",
  },
  "own-hand-residue": {
    caught: "text the owner would not have typed themselves is being sent under the owner's own name",
    correction: "compose it in the owner's voice, or send it as the bot rather than under the owner's identity",
    exceptions: ["a quotation of someone else's words inside the message"],
    gate: "own-hand-residue",
  },
  "register-bindings": {
    caught:
      "a failure class or a replay fixture names the other and the link does not resolve, or a live class has no bindings row at all, so the register claims a lane holds it down that does not",
    correction:
      "point the row at a gate the plan runs, a test a lane collects or a fixture the replay lane materialises, adding `// register-class: <name>` to that test or `turn freeze --regresses` to that fixture; `none`/`none` when nothing binds it yet",
    exceptions: [
      "a class whose mechanism is prose or judgement, which binds `none` and says so",
      "a fixture regressing no named class, which declares an empty list — most do not",
    ],
    gate: "register-bindings",
  },
  "register-bindings-closed": {
    caught:
      "a class still listed as a build candidate declares its mechanism already CLOSES it, which is how three rows sat in the build tables with the work already shipped",
    correction:
      "move it to Gated naming what closed it, keeping its targets — or downgrade the claim to `narrows`, the honest value for a partial closure",
    exceptions: ["a class only NARROWED by its mechanism, which declares `narrows` and stays a candidate"],
    gate: "register-bindings",
  },
  "register-hygiene": {
    caught:
      "a board row is malformed, or is parked on a question standing doctrine has already answered, so the one register of what is in flight cannot be read correctly",
    correction:
      "repair the row through the handover verbs rather than editing the file by hand — and where the row is parked on something already granted, go and do the thing rather than waiting on the owner",
    exceptions: ["an advisory finding about an unrelated repository, which reports and passes"],
    gate: "register-hygiene",
  },
  "retired-claude-transport": {
    caught: "a retired model transport is being reintroduced, which rule 2 removed rather than deprecated",
    correction: "delete the transport; reasoning happens in an already-visible session",
    exceptions: ["a doc comment naming the retired transport to explain that it is gone"],
    gate: "retired-claude-transport",
  },
  "secrets-registry": {
    caught:
      "the credential register disagrees with the tree — with the security document's table, with a reader that does not resolve it, or with a file standing in the store that no row declares",
    correction:
      "make the change each line above names — correct the row, paste the printed table and reformat, add the missing row, or, for a store file a line names another branch as declaring, leave it to that branch's session",
    exceptions: [
      "a retired entry with no reader, which the register carries deliberately",
      "a store file an unlanded branch declares, whose row lands with its reader on that branch",
    ],
    gate: "secrets-registry",
  },
} as const satisfies Readonly<Record<string, LintGateDeclaration>>;
