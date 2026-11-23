/**
 * `ProposalPublishDeps`, `VERB_ARG_OFFSET`, `refuse` and the production dependency bag — split out of
 * `./publishRun.js` so `./intakeRun.js` can depend on them without importing the publish and teaser shells.
 *
 * The split is what keeps `proposal intake` off the lint, render and teaser modules entirely: the intake
 * verb loads this file and `../../../outbound/proposal/intake.js`, and nothing a publish needs.
 */
import { readFileSync } from "node:fs";

import type { Result } from "#lib/result.js";
import { logger } from "../../../lib/logger.js";
import { notionPageAddress, type ProposalAddress } from "../../../outbound/proposal/address.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";
import { type ProfileReadError, readExactVoiceRules } from "../../../profileStore.js";
import { notionPageLocator, type PublishTarget, publishTargetProvider } from "./publishCore.js";

/** Where a verb's own arguments start in `process.argv`: after node, the script, the noun and the verb. */
export const VERB_ARG_OFFSET = 4;

/**
 * What a destination reported back: the exit code, and the provider-tagged address it wrote. The address is
 * absent when nothing was written (a dry run, a refusal), and PRESENT on a partial failure that still created
 * the artifact, so the next publish updates it rather than creating a second one.
 */
export interface PublishOutcome {
  readonly code: number;
  readonly address: ProposalAddress | undefined;
}

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface ProposalPublishDeps {
  readonly readText: (args: { source: string }) => string;
  /** The operator's exact voice rules, or why `profile.json` is there but cannot be trusted. */
  readonly voiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], ProfileReadError>;
  readonly now: () => Date;
  /**
   * Write the proposal to its destination: a create at the install's destination, or an update of the address
   * this intake already published. The ONE place a destination's own door is chosen, keyed on the target.
   */
  readonly publish: (args: {
    target: PublishTarget;
    markdown: string;
    home: string;
    title: string | undefined;
    icon: string | undefined;
    /** Where the draft's `file:` image placeholders resolve from — the draft file's own directory. */
    mediaBase: string;
    dryRun: boolean;
    /** The intake this publish belongs to, which a local page keys its slug on. */
    intakeId: string | undefined;
  }) => Promise<PublishOutcome>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * Print each line to stderr and return the code.
 *
 * @param deps the injectable edges
 * @param lines the lines to print
 * @param code the exit code to return
 * @returns `code`, unchanged
 */
export function refuse({
  deps,
  lines,
  code,
}: {
  deps: Pick<ProposalPublishDeps, "err">;
  lines: readonly string[];
  code: number;
}): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/**
 * The `notion-page` destination: delegate to the `notion page` command rather than to a second Notion writer,
 * and read the page id and URL out of that verb's own report.
 */
async function publishToNotion({
  target,
  markdown,
  home,
  title,
  icon,
  mediaBase,
  dryRun,
}: Parameters<ProposalPublishDeps["publish"]>[0]): Promise<PublishOutcome> {
  const locator = notionPageLocator({ target });
  // Imported lazily so `intake` and `teaser` never load the Notion client at all.
  const { productionNotionPageDeps, runNotionPage } = await import("../notion/pageRun.js");
  const base = productionNotionPageDeps();
  let pageUrl: string | undefined;
  let writtenId: string | undefined;
  const code = await runNotionPage({
    argv: [
      "node",
      "slopweaver",
      "notion",
      "page",
      locator.verb,
      locator.flag,
      locator.value,
      ...(title === undefined ? [] : ["--title", title]),
      ...(icon === undefined ? [] : ["--icon", icon]),
      ...(dryRun ? ["--dry-run"] : []),
      "--media-base",
      mediaBase,
      "--body",
      "-",
      "--home",
      home,
    ],
    deps: {
      ...base,
      out: (line) => {
        // The page id and URL are read out of the verb's OWN report rather than returned by a second
        // code path, so the two can never disagree about what was published.
        const id = /^(?:created|updated|partial) page ([0-9a-f-]{36})/.exec(line)?.[1];
        if (id !== undefined) {
          writtenId = id;
        }
        if (line.startsWith("https://")) {
          pageUrl = line.trim();
        }
        base.out(line);
      },
      readBody: () => markdown,
    },
  });
  const address = writtenId === undefined ? undefined : notionPageAddress({ pageId: writtenId, pageUrl });
  return { address, code };
}

/**
 * The live edges, with `publish` handing each destination to its own door rather than to a second writer.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionProposalPublishDeps(): ProposalPublishDeps {
  return {
    err: (line) => process.stderr.write(`proposal: ${line}\n`),
    now: () => new Date(),
    out: (line) => {
      logger.out({ line });
    },
    publish: async (args) => {
      // Each destination is imported lazily, so `intake` and `teaser` load none of them, and a publish loads
      // only the one it writes to.
      const provider = publishTargetProvider({ target: args.target });
      if (provider === "linear") {
        const [{ publishLinearProposal }, { runLinearDocument }, { productionLinearDocumentWriteDeps }] =
          await Promise.all([
            import("./publishLinear.js"),
            import("../linear/documentRun.js"),
            import("../linear/documentDeps.js"),
          ]);
        return publishLinearProposal({
          ...args,
          documentDeps: productionLinearDocumentWriteDeps(),
          err: (line) => process.stderr.write(`proposal: ${line}\n`),
          runDocument: runLinearDocument,
        });
      }
      if (provider === "local") {
        const [{ publishLocalProposal }, { productionPublishPage }] = await Promise.all([
          import("./publishLocal.js"),
          import("../../../pages/productionPublish.js"),
        ]);
        return publishLocalProposal({
          ...args,
          err: (line) => process.stderr.write(`proposal: ${line}\n`),
          nowIso: new Date().toISOString(),
          out: (line) => {
            logger.out({ line });
          },
          publishPage: productionPublishPage,
        });
      }
      return publishToNotion(args);
    },
    readText: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8")),
    voiceRules: ({ home }) => readExactVoiceRules({ home }),
  };
}
