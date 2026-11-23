import { describe, expect, it } from "vitest";

import { STATE_HOME_VERSION, stateHomePaths } from "../../stateHome.js";

describe("stateHomePaths", () => {
  const home = "/tmp/sw-home";

  it("pins every sub-path exactly under the given home", () => {
    const p = stateHomePaths({ home });
    expect(p.root).toBe("/tmp/sw-home");
    expect(p.homeVersion).toBe("/tmp/sw-home/.home-version.json");
    expect(p.consoleSyncFailureAppendFailuresJsonl).toBe("/tmp/sw-home/console-sync-failure-append-failures.jsonl");
    expect(p.corpus.root).toBe("/tmp/sw-home/corpus");
    expect(p.corpus.bronze).toBe("/tmp/sw-home/corpus/bronze");
    expect(p.corpus.silver).toBe("/tmp/sw-home/corpus/silver");
    expect(p.corpus.gold).toBe("/tmp/sw-home/corpus/gold");
    expect(p.corpus.cache).toBe("/tmp/sw-home/corpus/.cache");
    expect(p.corpus.watermark).toBe("/tmp/sw-home/corpus/.watermark.json");
    expect(p.knowledge).toBe("/tmp/sw-home/knowledge");
    expect(p.knowledgeLessonsJsonl).toBe("/tmp/sw-home/knowledge/lessons.jsonl");
    expect(p.knowledgeDomainsJson).toBe("/tmp/sw-home/knowledge/domains.json");
    expect(p.judgement.ownerDirectivesJson).toBe("/tmp/sw-home/judgement/owner-directives.json");
    expect(p.ledgers).toBe("/tmp/sw-home/ledgers");
    expect(p.identityJson).toBe("/tmp/sw-home/identity.json");
    expect(p.profileJson).toBe("/tmp/sw-home/profile.json");
    expect(p.respondersJson).toBe("/tmp/sw-home/responders.json");
    expect(p.gmailTriageRulesJson).toBe("/tmp/sw-home/gmail-triage-rules.json");
    expect(p.alignmentBoardJson).toBe("/tmp/sw-home/alignment-board.json");
    expect(p.slackDraftMedia).toBe("/tmp/sw-home/queue/slack-draft-media");
    expect(p.hygieneDenylist).toBe("/tmp/sw-home/hygiene-denylist.txt");
    expect(p.referenceMap).toBe("/tmp/sw-home/hygiene/reference-map.tsv");
    expect(p.privateTerms).toBe("/tmp/sw-home/hygiene/private-terms.tsv");
    expect(p.privateTermProposals).toBe("/tmp/sw-home/hygiene/private-term-proposals");
    expect(p.privateTermReviews).toBe("/tmp/sw-home/hygiene/private-term-reviews");
    expect(p.indirectReferenceMap).toBe("/tmp/sw-home/hygiene/indirect-reference-map.tsv");
    expect(p.indirectReferenceReport).toBe("/tmp/sw-home/hygiene/indirect-reference-report.json");
    expect(p.zeroReferencesProofDir).toBe("/tmp/sw-home/proof/zero-references");
    expect(p.githubExposureReports).toBe("/tmp/sw-home/evidence/github-exposure");
    expect(p.publicationAuditReports).toBe("/tmp/sw-home/evidence/publication-audit");
    expect(p.live.recipe.root).toBe("/tmp/sw-home/live/recipe");
    expect(p.live.recipe.teamRepositoriesJson).toBe("/tmp/sw-home/live/recipe/team-repositories.json");
    expect(p.live.slack.owedJson).toBe("/tmp/sw-home/live/slack/owed.json");
    expect(p.live.slack.awaitingJson).toBe("/tmp/sw-home/live/slack/awaiting.json");
    expect(p.live.slack.findingFollowupsJson).toBe("/tmp/sw-home/live/slack/finding-followups.json");
  });

  it("puts the plan register at the home root and scopes the Codex quota cache to a directory", () => {
    const p = stateHomePaths({ home });
    expect(p.plansJson).toBe("/tmp/sw-home/plans.json");
    expect(p.codexQuotaDir).toBe("/tmp/sw-home/codex-quota");
    expect(p.codexQuotaJson).toBe("/tmp/sw-home/codex-quota.json");
  });

  it("keeps the alias-scoped Codex cache directory out of the legacy single-file path", () => {
    const p = stateHomePaths({ home });
    expect(p.codexQuotaJson.startsWith(`${p.codexQuotaDir}/`)).toBe(false);
  });

  it("keeps bronze/silver/gold under the corpus root (the post-rename medallion layout)", () => {
    const p = stateHomePaths({ home });
    expect(p.corpus.bronze.startsWith(`${p.corpus.root}/`)).toBe(true);
    expect(p.corpus.silver.startsWith(`${p.corpus.root}/`)).toBe(true);
    expect(p.corpus.gold.startsWith(`${p.corpus.root}/`)).toBe(true);
  });

  it("normalises sub-paths under a trailing-slash home (no doubled separator)", () => {
    const p = stateHomePaths({ home: "/tmp/sw-home/" });
    expect(p.corpus.bronze).toBe("/tmp/sw-home/corpus/bronze");
    expect(p.identityJson).toBe("/tmp/sw-home/identity.json");
    expect(p.respondersJson).toBe("/tmp/sw-home/responders.json");
    expect(p.slackDraftMedia).toBe("/tmp/sw-home/queue/slack-draft-media");
  });

  it("exposes a numeric layout version", () => {
    expect(STATE_HOME_VERSION).toBe(1);
  });
});
