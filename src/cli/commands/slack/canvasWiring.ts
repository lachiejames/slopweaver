/**
 * `slack canvas`'s seams, split out of `./canvasRun.ts` so the shell stays one reviewable file: the injected
 * dependency bag every effect goes through, and the production wiring that fills it.
 */
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { type PainPointLane, recordExactVoicePainPoints } from "../../../admit/painPoint.js";
import { slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { ExactVoiceRule, ExactVoiceRuleFinding } from "../../../outbound/voice/exactRules.js";
import { type ProfileReadError, readExactVoiceRules } from "../../../profileStore.js";
import { CANVAS_STDIN_SENTINEL } from "./canvasCore.js";
import type { SlackRead } from "./readErrors.js";
import { readMarkdownSource } from "./workspaceShapeRun.js";

/** The injected seams. Each touches something real, so each is replaceable in a test without a mock. */
export interface CanvasDeps {
  readonly botToken: (args: { home: string }) => string | undefined;
  readonly userToken: (args: { home: string }) => string | undefined;
  readonly createCanvas: (args: { home: string; token: string; title: string; markdown: string }) => Promise<string>;
  readonly createChannelCanvas: (args: {
    home: string;
    token: string;
    channel: string;
    title: string;
    markdown: string;
  }) => Promise<string>;
  readonly replaceCanvas: (args: { home: string; token: string; canvasId: string; markdown: string }) => Promise<void>;
  readonly deleteCanvas: (args: { home: string; token: string; canvasId: string }) => Promise<boolean>;
  /** The door ledger every canvas write's decision is recorded through before anything is performed. */
  readonly doorLedger: DoorLedgerPort;
  readonly readMarkdown: (args: { source: string }) => Promise<SlackRead<string>>;
  readonly emit: (line: string) => void;
  readonly nowIso: () => string;
  /** The operator's exact voice rules, for the canvas title and its whole markdown body. */
  readonly voiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], ProfileReadError>;
  /** Record exact-rule matches as bounded future-turn guidance; this observation never decides the write. */
  readonly recordVoicePainPoints: (args: {
    home: string;
    findings: readonly ExactVoiceRuleFinding[];
    lane: PainPointLane;
  }) => void;
  /** The environment the voice hatch is read from, injected so the shell resolves it rather than the gate. */
  readonly env: () => Readonly<Record<string, string | undefined>>;
}

/** A transport for a canvas call, under the verb's own home: its privacy policy judges every write. */
const canvasTransport = ({ home, token }: { home: string; token: string }) => makeSlackWriteTransport({ home, token });

/**
 * The production wiring.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function liveCanvasDeps(): CanvasDeps {
  return {
    botToken: ({ home }) => slackBotToken({ home }),
    createCanvas: async ({ home, token, title, markdown }) =>
      canvasTransport({ home, token }).createCanvas({ markdown, title }),
    createChannelCanvas: async ({ home, token, channel, title, markdown }) =>
      canvasTransport({ home, token }).createChannelCanvas({ channel, markdown, title }),
    deleteCanvas: async ({ home, token, canvasId }) => canvasTransport({ home, token }).deleteCanvas({ canvasId }),
    doorLedger: doorLedgerPort(),
    emit: (line) => {
      logger.out({ line });
    },
    env: () => process.env,
    nowIso: () => new Date().toISOString(),
    readMarkdown: async ({ source }) => readMarkdownSource({ source, stdinSentinel: CANVAS_STDIN_SENTINEL }),
    recordVoicePainPoints: ({ findings, home, lane }) => {
      recordExactVoicePainPoints({ findings, home, lane, tsIso: new Date().toISOString() });
    },
    replaceCanvas: async ({ home, token, canvasId, markdown }) =>
      canvasTransport({ home, token }).replaceCanvas({ canvasId, markdown }),
    userToken: ({ home }) => slackUserToken({ home }),
    voiceRules: ({ home }) => readExactVoiceRules({ home }),
  };
}
