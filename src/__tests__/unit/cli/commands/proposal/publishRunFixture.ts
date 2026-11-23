/**
 * The fixtures `publishRun.test.ts` drives the `proposal intake`, `publish` and `teaser` commands with: the
 * golden document, the synthetic page, state homes with and without a destination, and a recording harness.
 *
 * Kept apart from the test file so the file that holds the ASSERTIONS stays under the test-file size cap
 * without any assertion leaving it. Nothing here asserts; every edge is a plain injected function, no mocks.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROPOSAL_FORM_EXAMPLE } from "../../../../../cli/commands/proposal/formExample.js";
import type { PublishTarget } from "../../../../../cli/commands/proposal/publishCore.js";
import type { ProposalPublishDeps } from "../../../../../cli/commands/proposal/publishRunShared.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import type { ProposalAddress } from "../../../../../outbound/proposal/address.js";
import { PROPOSAL_DESTINATION_SCHEMA_VERSION } from "../../../../../outbound/proposal/destination.js";
import { writeProposalDestination } from "../../../../../outbound/proposal/destinationStore.js";
import { deriveIntake, type ProposalIntake } from "../../../../../outbound/proposal/intake.js";
import { renderProposal } from "../../../../../outbound/proposal/render.js";

/** The rendered example form: a document the lint passes. */
export const GOLDEN: string = renderProposal({ form: PROPOSAL_FORM_EXAMPLE });
/** The harness clock. */
export const NOW: Date = new Date("2026-08-22T02:00:00.000Z");
/** The synthetic Notion page every destination in these tests creates under. */
export const PARENT = "39100000-0000-8102-a2f7-d1d8ef1fe6b0";
/** The synthetic page id the harness reports a publish created or updated. */
export const PAGE = "3c300000-0000-817e-95a2-ce6327ec9269";
/** The synthetic page URL the harness reports beside {@link PAGE}. */
export const URL = "https://app.notion.com/p/a-0000000000000000000000000000a006";
/** The provider-tagged address a publish through the harness records: {@link PAGE} at {@link URL}. */
export const ADDRESS: ProposalAddress = { id: PAGE, provider: "notion", url: URL };

/**
 * argv as the router hands it over: node, script, noun, verb, then the verb's own arguments.
 *
 * @param verb the proposal verb
 * @param rest the verb's own arguments
 * @returns the full argv
 */
export function argv({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "proposal", verb, ...rest];
}

// Every state home minted here, handed to the test file's `afterEach` to remove (this module removes nothing).
const minted: string[] = [];

/**
 * Hand over every state home minted since the last call, for the test file to remove.
 *
 * @returns the minted directories, now forgotten here
 */
export function takeMintedHomes(): string[] {
  return minted.splice(0);
}

/**
 * A state home with NO proposal destination set.
 *
 * @returns its path
 */
export function bareHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-proposal-publish-"));
  minted.push(dir);
  return dir;
}

/**
 * A state home whose install publishes proposals under {@link PARENT}.
 *
 * @returns its path
 */
export function tempHome(): string {
  const dir = bareHome();
  unwrap(
    writeProposalDestination({
      destination: { kind: "notion-page", parent: PARENT, schemaVersion: PROPOSAL_DESTINATION_SCHEMA_VERSION },
      home: dir,
    }),
  );
  return dir;
}

/**
 * An intake with every question answered, so it does not itself block a publish.
 *
 * @returns the intake, not yet saved
 */
export function answeredIntake({ id }: { id: string }): ProposalIntake {
  const intake = deriveIntake({ brief: "a brief", id, now: NOW });
  return { ...intake, questions: intake.questions.map((question) => ({ ...question, answer: "yes" })) };
}

/** What the harness's `publish` was last asked to do, with the Notion locator read off its target. */
interface PublishedCall {
  readonly target: PublishTarget;
  readonly markdown: string;
  readonly parent: string | undefined;
  readonly pageId: string | undefined;
  readonly mediaBase: string;
  readonly dryRun: boolean;
  readonly title: string | undefined;
  readonly intakeId: string | undefined;
}

/** The `--parent` a create target names, when its destination is a Notion page. */
function createParent({ target }: { target: PublishTarget }): string | undefined {
  if (target.kind === "create" && target.destination.kind === "notion-page") {
    return target.destination.parent;
  }
  return undefined;
}

/**
 * A recording harness: injected edges that log, plus captured output.
 *
 * @param text what `readText` answers for any path
 * @param code the exit code the injected `publish` reports
 * @param address the address the injected `publish` reports writing; {@link ADDRESS} unless given
 * @returns the deps, the captured lines, and the last publish call
 */
export function harness({
  text = GOLDEN,
  code = EXIT_OK,
  address = ADDRESS,
}: { text?: string; code?: number; address?: ProposalAddress | undefined } = {}): {
  deps: ProposalPublishDeps;
  out: string[];
  err: string[];
  published: () => PublishedCall | undefined;
} {
  const out: string[] = [];
  const err: string[] = [];
  let published: PublishedCall | undefined;
  return {
    deps: {
      err: (line) => err.push(line),
      now: () => NOW,
      out: (line) => out.push(line),
      publish: (args) => {
        published = {
          dryRun: args.dryRun,
          intakeId: args.intakeId,
          markdown: args.markdown,
          mediaBase: args.mediaBase,
          pageId: args.target.kind === "update" ? args.target.address.id : undefined,
          parent: createParent({ target: args.target }),
          target: args.target,
          title: args.title,
        };
        return Promise.resolve({ address, code });
      },
      readText: () => text,
      voiceRules: () => ok([]),
    },
    err,
    out,
    published: () => published,
  };
}
