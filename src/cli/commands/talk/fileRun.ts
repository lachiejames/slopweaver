/**
 * `slopweaver talk file` — any file or directory on this machine, bounded and with credentials kept on it: the
 * console voice's `file_read` and `file_list`. Two modes, one verb: `read`, `list`.
 *
 * The voice is as capable as any Claude session, so it reads what a Claude session reads. What it refuses and masks, and why, is `src/talk/localPath.ts` and `src/talk/fileRedaction.ts`;
 * the reads themselves are `src/talk/localFile.ts`. A refused credential path is a POLICY refusal and prints the
 * `talk-file-credential` hatch; every other failure is a fact about the path and prints only its message. A path
 * inside one the owner protected `no-access` (`slopweaver protect`) is refused ahead of every credential rule, and the
 * credential hatch never lifts it.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";

import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { userDefaultHome } from "../../../homeDir.js";
import { loadDenylistResult } from "../../../hygiene/scan.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { type ProtectedPath, readProtectedPaths } from "../../../protectedPaths/registry.js";
import { stateHomePaths } from "../../../stateHome.js";
import { withPublishedPagesReader } from "../../../store/publishedPages/read.js";
import { heldPageRefusal, publishedPageOf, readHeldPage } from "../../../talk/heldPage.js";
import { type LocalRead, type LocalReadPolicy, listLocalDir, readLocalFile } from "../../../talk/localFile.js";
import { type LocalFileError, LocalFileErrors } from "../../../talk/localFileErrors.js";
import type { LocalImageRead } from "../../../talk/localImage.js";
import { credentialStores, slopweaverHomesOf } from "../../../talk/localPath.js";
import { outlineShortened, PAGE_TOOL_ANSWER_MAX_BYTES, type PageHeading } from "../../../talk/pageOutline.js";
import { readPageWords } from "../../../talk/pageWordsRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { type FileArgs, parseFileArgs } from "./fileArgs.js";
import { TALK_FILE_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "file", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the `talk file` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkFile(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_FILE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFileArgs({ rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: TALK_FILE_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  const policy = policyOf({ home });
  if (policy === undefined) {
    logger.error({
      msg: "talk file: the private hygiene denylist exists but could not be read, so nothing is read until it can be",
    });
    return EXIT_ERROR;
  }
  if (args.mode === "list") {
    return runList({ args, policy });
  }
  return runRead({ args, home, policy });
}

/**
 * The line `talk file read --json` prints for a text window — what the console voice is handed, so what
 * `DEFAULT_CODE_BUDGET` has to fit inside the page's tool cap. The outline gives way first: headings are shed,
 * deepest and latest first, until the line fits, so a window that fits with no outline never overflows with one. A
 * heading shed here is a cut like any other, so `outlineCut` goes true with the first one and is never what is shed.
 *
 * @param read one masked text window
 * @returns the window as one compact JSON line
 */
export function fileReadJson({ read }: { read: LocalRead }): string {
  let { outline, outlineCut } = read;
  let json = fileReadDocument({ outline, outlineCut, read });
  while (Buffer.byteLength(json, "utf8") > PAGE_TOOL_ANSWER_MAX_BYTES && outline.length > 0) {
    outline = outlineShortened({ outline });
    outlineCut = true;
    json = fileReadDocument({ outline, outlineCut, read });
  }
  return json;
}

/**
 * One window serialised with a given outline. A long path beside a worst-case window
 * fitted the cap with no outline and overflowed with a full one, so the outline is what gives way.
 */
function fileReadDocument({
  read,
  outline,
  outlineCut,
}: {
  read: LocalRead;
  outline: readonly PageHeading[];
  outlineCut: boolean;
}): string {
  const whole = {
    kind: read.kind,
    nextFrom: read.window.nextFrom,
    path: read.path,
    redactions: read.redactions,
    resolvedPath: read.resolvedPath,
    size: read.size,
    start: read.window.start,
    text: read.text,
    truncated: read.window.truncated,
  };
  const document = outlineCut ? { ...whole, outlineCut } : whole;
  // An empty outline is no key at all, so a window with none is the very line it was before outlines existed.
  if (outline.length === 0) {
    return JSON.stringify(document);
  }
  return JSON.stringify({ ...document, outline });
}

/** `talk file read` — one bounded, masked window of one file. */
async function runRead({
  args,
  home,
  policy,
}: {
  args: FileArgs;
  home: string;
  policy: LocalReadPolicy;
}): Promise<number> {
  const read = await readTarget({ args, home, policy });
  if (read.isErr()) {
    return fail({ failure: read.error });
  }
  const value = read.value;
  if (value.kind === "image") {
    return printImage({ image: value, json: args.json });
  }
  if (args.json) {
    logger.out({ line: fileReadJson({ read: value }) });
    return EXIT_OK;
  }
  logger.out({ line: value.text });
  value.outline.forEach((heading) => {
    logger.out({ line: `-- outline h${String(heading.level)} at byte ${String(heading.from)}: ${heading.text}` });
  });
  let tail = `-- ${value.path}, bytes ${String(value.window.start)}..${String(value.window.end)} of ${String(value.size)}`;
  if (value.window.nextFrom !== null) {
    tail += ` — continue with --from ${String(value.window.nextFrom)}`;
  } else if (value.window.start === 0) {
    tail = `-- ${value.path}, whole file (${String(value.size)} bytes)`;
  }
  logger.out({ line: tail });
  value.redactions.forEach((redaction) => {
    logger.out({ line: `-- masked ${String(redaction.count)} ${redaction.label}` });
  });
  return EXIT_OK;
}

/**
 * What a read names: a published page's document, `<home>/pages/<slug>/index.html`, out of the store and never the
 * folder (`src/talk/heldPage.ts`); any other path off disk. A page address the store cannot answer is a refusal,
 * never a cue to read the folder instead, so a voice reading pages works the same the day the folders are gone.
 */
async function readTarget({
  args,
  home,
  policy,
}: {
  args: FileArgs;
  home: string;
  policy: LocalReadPolicy;
}): Promise<Result<LocalRead | LocalImageRead, LocalFileError>> {
  const page = publishedPageOf({ home, homeDir: policy.homeDir, raw: args.target });
  if (page === undefined) {
    const window = { budget: args.budget, from: args.from, policy, raw: args.target };
    return args.words ? readPageWords(window) : readLocalFile(window);
  }
  const path = page.address;
  const refused = heldPageRefusal({ path, policy });
  if (refused !== undefined) {
    return err(refused);
  }
  const held = await withPublishedPagesReader({ home, read: (reader) => reader.document({ pageKey: page.slug }) });
  if (held.isErr()) {
    if (held.error.code === "PAGES_NOT_PUBLISHED") {
      return err(LocalFileErrors.pageNotInStore({ path }));
    }
    return err(LocalFileErrors.pageStoreUnreadable({ detail: held.error.message, path }));
  }
  const { budget, from, words } = args;
  return readHeldPage({ budget, bytes: held.value, denylist: policy.denylist, from, path, words });
}

/**
 * A picture: whole and base64 under `--json`, for the console page to draw and re-encode; named in one line
 * otherwise, since base64 on a terminal is nothing anyone reads.
 */
function printImage({ image, json }: { image: LocalImageRead; json: boolean }): number {
  if (json) {
    logger.out({ line: JSON.stringify(image) });
    return EXIT_OK;
  }
  logger.out({
    line: `-- ${image.path}, a picture (${image.mediaType}, ${String(image.size)} bytes) — --json carries it base64`,
  });
  return EXIT_OK;
}

/** `talk file list` — one directory, one level deep. */
function runList({ args, policy }: { args: FileArgs; policy: LocalReadPolicy }): number {
  const listed = listLocalDir({ limit: args.limit, policy, raw: args.target });
  if (listed.isErr()) {
    return fail({ failure: listed.error });
  }
  const value = listed.value;
  if (args.json) {
    logger.out({ line: JSON.stringify(value) });
    return EXIT_OK;
  }
  value.entries.forEach((entry) => {
    const size = entry.size === null ? "" : ` ${String(entry.size)}`;
    const refused = entry.refused ? " (credential, not read)" : "";
    logger.out({ line: `${entry.kind}\t${entry.name}${size}${refused}` });
  });
  logger.out({ line: `-- ${String(value.entries.length)} of ${String(value.total)} entries in ${value.dir}` });
  return EXIT_OK;
}

/**
 * The refusal set and the masking list for this invocation, or `undefined` when any Slopweaver home's denylist
 * exists and could not be read — masking without it would send the very strings it lists. Every home's stores
 * and every home's denylist count, not only the one in use: a file in another home is one path away. The
 * `talk-file-credential` hatch lifts the credential PATH refusal, never the masking.
 */
function policyOf({ home }: { home: string }): LocalReadPolicy | undefined {
  const homeDir = homedir();
  const homeEntries = entriesOf({ dir: homeDir });
  const slopweaverHomes = slopweaverHomesOf({ homeDir, homeEntries, named: [home, userDefaultHome()] });
  const denylist = new Set<string>();
  for (const slopweaverHome of slopweaverHomes) {
    const loaded = loadDenylistResult({ home: slopweaverHome });
    if (loaded.kind === "unreadable") {
      return undefined;
    }
    if (loaded.kind === "loaded") {
      loaded.lines.forEach((line) => denylist.add(line));
    }
  }
  const unresolved = credentialStores({ homeDir, homeEntries, slopweaverHomes });
  const resolved = unresolved.filter((store) => existsSync(store)).map((store) => realpathSync.native(store));
  const hatchSet = process.env["SLOPWEAVER_ALLOW_TALK_FILE_CREDENTIAL"] === "1";
  return {
    denylist: [...denylist],
    homeDir,
    protectedPaths: ownerProtectedPaths({ homes: [home, userDefaultHome()] }),
    refusalsLifted: hatchSet,
    stores: [...new Set([...unresolved, ...resolved])],
  };
}

/**
 * Every path the owner protected in the home in use and the default one (`slopweaver protect`). A registry that cannot
 * be read protects nothing here, as it protects nothing in the hook — `protect list` is what reports it.
 */
function ownerProtectedPaths({ homes }: { homes: readonly string[] }): readonly ProtectedPath[] {
  return [...new Set(homes)].flatMap((home) => {
    const registry = readProtectedPaths({
      file: stateHomePaths({ home }).protectedPathsJson,
      readText: ({ path }) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
    });
    return registry.isOk() ? registry.value.paths : [];
  });
}

/** The names directly inside a directory; none when it cannot be read, which leaves only the named stores. */
function entriesOf({ dir }: { dir: string }): readonly string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Print a typed failure — with the hatch's four lines when it is the credential refusal — and exit non-zero. */
function fail({ failure }: { failure: LocalFileError }): number {
  if (failure.code === "PATH_REFUSED") {
    logger.error({ msg: hatchRefusal({ detail: failure.message, hatch: hatchFor({ id: "talk-file-credential" }) }) });
    return EXIT_ERROR;
  }
  logger.error({ msg: `talk file: ${failure.message}` });
  return EXIT_ERROR;
}

export const talkFileCommand = defineCommand({ run: runTalkFile });
