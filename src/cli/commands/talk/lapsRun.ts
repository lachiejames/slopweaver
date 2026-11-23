/**
 * `slopweaver talk laps` — how many laps each Queue card took to reach the owner, and the steers the owner gave between: every card
 * the owner looked at in the window, its looks, its laps split into the fleet's and the world's, and the owner's words in each
 * (`src/talk/cardLaps.ts`).
 *
 * The console reads `--json` to draw a card's laps under its title and the first-look count at the head of the Queue
 * (`site/components/console/CardLaps.tsx`); this prints the same reading for a session.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { type CardLaps, calibrateMatcher, MATCH_MARGIN } from "../../../talk/cardLaps.js";
import { type CardLapsReading, LAPS_WINDOW_MS, readCardLaps, readLapsInputs } from "../../../talk/cardLapsRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { wordsWindow } from "../profile/wordsArgs.js";
import { talkHomeOf } from "./args.js";
import { type LapsArgs, parseLapsArgs } from "./cardArgs.js";
import { TALK_LAPS_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "laps", ...]`. */
const VERB_ARG_OFFSET = 4;

/** One card's headline: its key, then first look or its laps and who caused them. */
function cardLine({ card }: { card: CardLaps }): string {
  let laps = "one look";
  if (card.laps > 0) {
    laps = `${String(card.laps)} lap(s): ${String(card.fleetLaps)} fleet, ${String(card.worldLaps)} world`;
  }
  return `${card.key}  ${laps} · steering ${String(card.steeringChars)} chars, last look ${String(card.lastLookChars)}`;
}

/** The shared-rare-token floors a calibration tries, from the corpus's own coverage floor upward. */
const CALIBRATION_FLOORS: readonly number[] = [2, 3, 4, 5, 6];

/** Score the matcher over the words whose card is recorded, and print how it did at each floor. */
function calibrationLines({
  home,
  claudeHome,
  handoverDir,
  nowIso,
  sinceIso,
  json,
  out,
}: {
  home: string;
  claudeHome: string;
  handoverDir: string;
  nowIso: string;
  sinceIso: string;
  json: boolean;
  out: (line: string) => void;
}): number {
  const inputs = readLapsInputs({ claudeHome, handoverDir, home, nowIso, sinceIso });
  const calibration = calibrateMatcher({ ...inputs, floors: CALIBRATION_FLOORS });
  if (json) {
    out(
      safeJsonStringify({
        label: "talk laps calibration",
        value: { ok: true, sinceIso, ...calibration, gaps: inputs.gaps },
      }),
    );
    return calibration.named > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
  }
  out(
    `talk laps --calibrate: ${String(calibration.named)} word(s) since ${sinceIso} name a card a keyword matcher could ` +
      `pick (margin ${String(MATCH_MARGIN)}); the reading places none by keyword until one is right here`,
  );
  calibration.rows.forEach((row) => {
    out(`  floor ${String(row.floor)}: attributed ${String(row.attributed)}, ${String(row.correct)} to the named card`);
  });
  return calibration.named > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * The verb's body with its inputs injected — what the unit test drives, since `logger.out` cannot be read back.
 *
 * @param args the parsed flags
 * @param home the Slopweaver home
 * @param claudeHome the directory holding Claude Code's `projects`
 * @param handoverDir the board directory
 * @param nowIso the instant read at, which a span counts back from
 * @param out where each line goes
 * @returns 0 with a card, 3 with none, 2 on a window that holds nothing
 */
export function talkLaps({
  args,
  home,
  claudeHome,
  handoverDir,
  nowIso,
  out,
}: {
  args: LapsArgs;
  home: string;
  claudeHome: string;
  handoverDir: string;
  nowIso: string;
  out: (line: string) => void;
}): number {
  let since = new Date(Date.parse(nowIso) - LAPS_WINDOW_MS).toISOString();
  if (args.since !== undefined) {
    since = args.since;
  }
  const window = wordsWindow({ nowIso, since, until: undefined });
  if (window.isErr()) {
    window.error.forEach((problem) => {
      out(`talk laps: ${problem}`);
    });
    return EXIT_USAGE;
  }
  if (args.calibrate) {
    return calibrationLines({
      claudeHome,
      handoverDir,
      home,
      json: args.json,
      nowIso,
      out,
      sinceIso: window.value.sinceIso,
    });
  }
  const reading = readCardLaps({ claudeHome, home, nowIso, sinceIso: window.value.sinceIso });
  if (args.json) {
    out(safeJsonStringify({ label: "talk laps", value: { ok: true, ...reading } }));
  } else {
    readingLines({ out, reading });
  }
  return reading.cards.length > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/** Print the reading as lines: the summary, each card and its laps, what named no card, and every gap. */
function readingLines({ reading, out }: { reading: CardLapsReading; out: (line: string) => void }): void {
  const { cards, gaps } = reading;
  const once = cards.filter((card) => card.laps === 0).length;
  const fleet = cards.reduce((sum, card) => sum + card.fleetLaps, 0);
  const world = cards.reduce((sum, card) => sum + card.worldLaps, 0);
  const steering = cards.reduce((sum, card) => sum + card.steeringChars, 0);
  const lastLooks = cards.reduce((sum, card) => sum + card.lastLookChars, 0);
  out(
    `talk laps: ${String(cards.length)} card(s) the owner looked at since ${reading.sinceIso} — ${String(once)} on one look; ` +
      `laps ${String(fleet)} fleet, ${String(world)} world; ${String(steering)} chars in earlier looks, ${String(lastLooks)} in last looks`,
  );
  cards.forEach((card) => {
    out(`  ${cardLine({ card })}`);
    card.steers.forEach((lap, position) => {
      const first = lap.words[0]!;
      out(
        `    lap ${String(position + 1)} (${lap.cause}) ${lap.startIso} ${first.anchor}: ${first.text.slice(0, 120)}`,
      );
    });
  });
  const { call, chair, relay, typed } = reading.unplaced;
  out(
    `  named no card, so on none: ${String(call)} call stretch(es), ${String(chair)} chair turn(s), ` +
      `${String(typed + relay)} console steer(s)`,
  );
  gaps.forEach((gap) => {
    out(`  not read whole (${gap.source}): ${gap.why}`);
  });
}

/**
 * Run the `talk laps` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkLaps(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_LAPS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseLapsArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_LAPS_USAGE });
    return EXIT_USAGE;
  }
  const home = talkHomeOf({ home: parsed.value.home });
  return talkLaps({
    args: parsed.value,
    claudeHome: claudeHomeDir(),
    handoverDir: resolveHandoverDir({ dir: undefined, home }),
    home,
    nowIso: new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
  });
}

export const talkLapsCommand = defineCommand({ run: runTalkLaps });
