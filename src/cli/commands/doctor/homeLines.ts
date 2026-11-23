/**
 * The per-file status renderers `doctor` reports a home and the machine's Codex files through — presence and
 * parse status only, never a file's contents, never a person's name. Pure apart from read-only fs probes, so a
 * fixture directory exercises every branch without a mock.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readJsonFile } from "../../../lib/jsonFile.js";
import { isRecord } from "../../../lib/parsers.js";
import type { Result } from "../../../lib/result.js";
import { parseProfile } from "../../../profile.js";
import { type IdentityRosterSnapshot, retiredRosterFileLine } from "../../../silver/identityRoster.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";

/** The store roster's row as `--deep` peeked it; undefined on the default run, which never reaches the store. */
export type PeekedIdentityRoster = Result<IdentityRosterSnapshot, IdentityRosterError> | undefined;

/**
 * `exists` + `(empty)` when a present directory has no entries — reveals scaffolded-but-unpopulated dirs.
 *
 * @returns `missing`, `exists (empty)` or `exists`
 */
export function dirStatus({ path }: { path: string }): string {
  if (!existsSync(path)) {
    return "missing";
  }
  try {
    return readdirSync(path).length === 0 ? "exists (empty)" : "exists";
  } catch {
    return "exists";
  }
}

/**
 * The home-version marker's value, or a not-initialised note.
 *
 * @returns the report line
 */
export function homeVersionLine({ path }: { path: string }): string {
  const parsed = readJsonFile({ path });
  if (isRecord(parsed) && typeof parsed["version"] === "number") {
    return `home version: ${String(parsed["version"])}`;
  }
  return "home version: not initialised — run `slopweaver init`";
}

/**
 * Parse-status of profile.json: missing / valid / invalid (with the reason), never its contents.
 *
 * @returns the report line
 */
export function profileLine({ path }: { path: string }): string {
  if (!existsSync(path)) {
    return "profile.json: missing — run `slopweaver init`";
  }
  const result = parseProfile({ value: readJsonFile({ path }) });
  return result.isOk()
    ? "profile.json: present (valid)"
    : `profile.json: present (INVALID: ${result.error.join("; ")})`;
}

/**
 * The identity roster's lines. The roster lives in the store; the default run stays boot-safe, so it reports
 * only whether the RETIRED `identity.json` is still in the home. `--deep` peeks the store row — a read that
 * imports nothing — and says what it holds, or that the store could not answer. Never a person's name.
 *
 * @param path where the retired file would sit
 * @param stored the peeked row under `--deep`; undefined on the default run, which never reaches the store
 * @returns the report lines
 */
export function identityLines({ path, stored }: { path: string; stored: PeekedIdentityRoster }): readonly string[] {
  if (stored === undefined) {
    const retired = existsSync(path)
      ? `the retired ${path} is still in the home (imported once if the store holds no row, inert beside one)`
      : "no retired identity.json in the home";
    return [`identity roster: in the store, not checked (--deep peeks it) — ${retired}`];
  }
  if (stored.isErr()) {
    return [`identity roster: store UNREADABLE — ${stored.error.message}`];
  }
  const { records, revision } = stored.value;
  const head =
    revision === null
      ? "identity roster: the store holds no row yet"
      : `identity roster: store row revision ${String(revision)}, ${String(records.length)} person record(s)`;
  const retired = retiredRosterFileLine({ snapshot: stored.value });
  return retired === undefined ? [head] : [head, `  ${retired}`];
}

/**
 * Whether `--deep` found the store unable to answer for the roster. That is a prerequisite absent, so `doctor`
 * exits on it exactly as on a fatal environment probe; printing UNREADABLE while exiting 0 would let a
 * `doctor --deep || alert` caller read an outage as a clean machine.
 *
 * @param stored the peeked row under `--deep`; undefined on the default run, which never asks the store
 * @returns true only when the peek ran and the store refused it
 */
export function rosterStoreAbsent({ stored }: { stored: PeekedIdentityRoster }): boolean {
  return stored?.isErr() === true;
}

/**
 * The identity roster's JSON status: the retired file's presence on the default run, the peeked row's state
 * under `--deep`. A closed vocabulary, never a count or a name.
 *
 * @param path where the retired file would sit
 * @param stored the peeked row under `--deep`; undefined on the default run
 * @returns the status word
 */
export function identityStatus({ path, stored }: { path: string; stored: PeekedIdentityRoster }): string {
  if (stored === undefined) {
    return existsSync(path) ? "retired-file-present" : "retired-file-absent";
  }
  if (stored.isErr()) {
    return "store-unreadable";
  }
  return stored.value.revision === null ? "store-no-row" : "store-row";
}

/**
 * Whether a Codex login exists. Presence only — the file is never read, copied or logged.
 *
 * `codex plan|review` is keyless: it inherits this process's environment and the bundled CLI finds this file
 * itself. So a missing login is not an error slopweaver can see until a pass fails, which is the kind of
 * silent prerequisite `doctor` exists to surface.
 *
 * @returns the report line
 */
export function codexAuthLine({ path }: { path: string }): string {
  return existsSync(path)
    ? "codex auth: present (used by `codex plan|review`; never read by slopweaver)"
    : "codex auth: missing — run `codex login`, or the codex verbs will fail at the first pass";
}

/**
 * What the machine's Codex config might still do, stated at its weakest.
 *
 * Deliberately narrow, because most of the worry here is already handled: `lockedThreadOptions` returns
 * `Required<ThreadOptions>`, so every sandbox, network and model option is supplied explicitly and this file
 * cannot silently override them. What it CAN still do is declare MCP servers, which Codex spawns at startup
 * regardless of `approvalPolicy` blocking their dispatch.
 *
 * The scan is a substring check, not a TOML parse — so it reports "cannot tell" rather than "none". A shallow
 * parse presented as a clean bill of health is the silent-failure class; admitting the limit is not.
 *
 * @returns the report line
 */
export function codexConfigLine({ path }: { path: string }): string {
  if (!existsSync(path)) {
    return "codex config: none — every thread option is supplied explicitly by slopweaver";
  }
  let declaresMcp: boolean;
  try {
    declaresMcp = readFileSync(path, "utf8").includes("[mcp_servers");
  } catch {
    return `codex config: present at ${path} but unreadable — cannot tell whether it declares MCP servers`;
  }
  return declaresMcp
    ? `codex config: present at ${path} and appears to declare MCP servers — Codex SPAWNS those at startup (dispatch is blocked, the process still runs)`
    : `codex config: present at ${path}; no MCP servers found by a shallow scan (a nested or quoted declaration would not be seen)`;
}

/**
 * The parse-only status of a JSON seed file — never its contents.
 *
 * @param valid whether the parsed JSON is the seed's accepted shape
 * @returns `present-valid`, `present-invalid` or `missing`
 */
export function seedStatus({ path, valid }: { path: string; valid: (value: unknown) => boolean }): string {
  if (!existsSync(path)) {
    return "missing";
  }
  return valid(readJsonFile({ path })) ? "present-valid" : "present-invalid";
}
