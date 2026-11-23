/**
 * The escape-hatch rows for the TOOLS a session reaches for on this machine — a sub-agent its brief forbids,
 * a raw provider call, a live write from a bot turn, Python, an ADC sign-in, a shell script and the Artifact
 * tool.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new tool-choice refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on a session's local tool choice, in register order. */
export const LOCAL_TOOL_HATCHES = [
  {
    caught:
      "this session recorded that its own brief forbids sub-agents, and a sub-agent it is not allowed to run is exactly what cooked the machine once — nineteen of them, each stuck 43 minutes on PreToolUse hooks, at load 146 against a hold of 22",
    command: "the Agent tool in a session whose brief forbids sub-agents",
    exceptions: [
      "the brief clause the ban cites has since been superseded by a ruling naming this work",
      "the fan-out is the deliverable the ask itself named, and the brief's prohibition was written for the session that dispatched this one rather than for this one",
    ],
    id: "session-subagent",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_SUBAGENT" },
    lane: "ambient",
    reader: "src/admit/agentToolBanGuardRunner.ts",
    standing: "proposed",
  },
  {
    caught: "a Bash call would reach a provider directly rather than through a slopweaver verb (rule 3, one door)",
    command: "a raw curl / gh / git provider call",
    exceptions: [
      "no verb covers this read and you are reading, not writing",
      "you are debugging the door itself and the call is against your own test fixture",
    ],
    id: "raw",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_RAW" },
    lane: "ambient",
    reader: "src/admit/rawTools.ts",
    standing: "ruled",
  },
  {
    caught:
      "a bot turn never runs or reruns a migration and never writes to staging or production — it diagnoses and reports, and reading is the safe lane",
    command: "a migration or live-system write from a bot turn",
    exceptions: [
      "the owner personally asked, in this turn's own ask, for exactly this run — their explicit word, never a colleague's request and never one relayed to the bot by another person",
    ],
    id: "bot-live-write",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_BOT_LIVE_WRITE" },
    // AMBIENT: a local command guard, not an outbound send. It opens only on the OWNER's ask — the runner refuses the
    // variable outright when the turn's asker is anyone else: another person's request never opens it.
    lane: "ambient",
    reader: "src/admit/botLiveWriteGuardRunner.ts",
    standing: "ruled",
  },
  {
    caught:
      "it runs a Python interpreter, and anything done with Python here is done as typed, tested TypeScript exposed through a slopweaver verb instead — a rule about which tool does the work, not about reaching a network",
    command: "a Bash or Monitor command running Python",
    exceptions: [
      "the program you need is a third-party tool written in Python with no TypeScript equivalent, and you are running it rather than writing Python",
      "you are running the Python original once as the parity oracle for the TypeScript verb that replaces it",
    ],
    id: "python",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_PYTHON" },
    // AMBIENT: a tool-choice rule on a local command, which sends nothing anywhere. `SLOPWEAVER_ALLOW_RAW`
    // never opens it, and it never opens a raw refusal — `../admit/hookPayload.ts` runs the two walks apart.
    lane: "ambient",
    reader: "src/admit/pythonInvocation.ts",
    standing: "proposed",
  },
  {
    caught:
      "it opens a browser sign-in whose localhost redirect listener lives in THIS session's shell, which does not wait for the owner — a seat that runs it and moves on leaves the owner's sign-in landing on a broken page",
    command: "gcloud auth application-default login",
    exceptions: [
      "the owner is at this session right now, asked you to run it here, and the call will stay in the foreground until they finish",
      "you are proving this refusal or the verb that replaces it, with --no-browser and nothing to finish",
    ],
    id: "adc-signin",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_ADC_SIGNIN" },
    // AMBIENT: it refuses a local command before anything leaves the machine. `SLOPWEAVER_ALLOW_RAW` never opens
    // it — that break-glass is what a seat reaches for once `gcloud` is refused — and it opens no raw refusal.
    lane: "ambient",
    reader: "src/admit/adcSigninCommand.ts",
    standing: "proposed",
  },
  {
    caught:
      "it is a shell script rather than one command, and a script here is a slopweaver verb instead, the way Python is (raw bash is banned like raw Python, with a few whitelisted exceptions); the line allows one command piped only through read-only filters, or two commands within 200 characters, and jq is refused wherever it runs",
    command: "a Bash command that is a shell script",
    exceptions: [
      "no verb does the job yet and you are running the script once to measure what that verb must do",
      "you are running a measured comment's reproduction command verbatim, which is a script by construction",
    ],
    id: "raw-bash",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_BASH" },
    // AMBIENT, for the reason the `python` row above gives: a tool-choice rule on a local command, which sends
    // nothing anywhere. `SLOPWEAVER_ALLOW_RAW` and `SLOPWEAVER_ALLOW_PYTHON` never open it, and it opens neither.
    lane: "ambient",
    reader: "src/admit/rawBash.ts",
    standing: "proposed",
  },
  {
    caught:
      "it publishes a page to claude.ai, and every page the owner reacts to is a local file at $SLOPWEAVER_HOME/pages/<slug>/index.html written by `slopweaver page publish` — a rule about WHERE a page lives, which is why a read of the gallery is caught too",
    command: "a call of the Artifact tool",
    exceptions: [
      "you are reading back a page published before this ruling, whose only copy is in the gallery, in order to save it to disk",
      "the owner named an artifact URL in this ask and reading it is how you answer them",
    ],
    id: "artifact",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_ARTIFACT" },
    // AMBIENT: it refuses a TOOL, on this machine, before anything leaves it. Neither `SLOPWEAVER_ALLOW_RAW`
    // nor `SLOPWEAVER_ALLOW_PYTHON` opens it and it opens neither of them — `../admit/hookPayload.ts` runs
    // all three walks apart, for the reason the Python row above gives.
    //
    // This hatch belongs to the HOOK and not to the user-level deny rule that sits beside it. The owner's settings'
    // `permissions.deny` is the host's own refusal and this variable does not lift it; what the hatch buys
    // is a session that can still read an old page when the deny is off, and a refusal that says why when it
    // is on.
    lane: "ambient",
    reader: "src/admit/artifactTool.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
