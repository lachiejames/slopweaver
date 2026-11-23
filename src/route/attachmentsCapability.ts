/**
 * The `attachments` routing row — what a document a door already serves actually SAYS.
 *
 * Held apart from `./genericCapabilities.ts` along the seam `file-size-ratchet` found, the same one
 * `./spendCapability.ts` and `./atlasEstateCapability.ts` sit on: that file is at its recorded ceiling, and
 * this row's rationale runs several times the length of the row. It is one row rather than a table, so it is
 * spliced back into `GENERIC_SOURCE_CAPABILITIES` by reference and nothing about merging, ordering,
 * `./sourceNouns.ts`'s partition or a private overlay's by-id replacement changes.
 *
 * ## WHICH document is a provider row. WHAT IT SAYS is this row.
 *
 * That sentence is the rule, and it is the test to apply to the next term somebody proposes here. The two
 * are different acts against different sources. "Did anyone send us the signed DPA" is a SEARCH over a
 * provider's own index, and only that provider can run it. "What does the DPA say" is an EXTRACTION over
 * bytes, and no provider's search can answer it.
 *
 * The cut matters most where one row can do only half. The `gmail` row's `terms` carry `attachment` and
 * `attachments` and KEEP them, because finding which message carried a file is genuinely its job and it is
 * the only leg that can search mail — while `gmail read` lists an attachment's filename and nothing else,
 * so the words are two hops (`./genericCapabilities.ts`'s gmail row says so, and says it there rather than
 * here, because that is the row a mail question lands on).
 *
 * ## Why one row rather than PDF vocabulary on the four provider rows
 *
 * `./genericCapabilities.ts`'s header states the rule this is an instance of — one class of word, one row —
 * and the SPEND finding is what it was written from. Four rows each carrying `pdf` would be that finding
 * repeating, and worse: the question a session is usually holding does not name a provider at all. "What
 * does the signed DPA say" selects none of Slack, Linear, Notion or Vanta, which is the same failure
 * `derivedAtlasTerms` had for `trelica` — a leg reachable the whole time and not FINDABLE.
 *
 * MEASURED, and it is worse than not being found. `pdf` appeared in no row's `terms` anywhere in the
 * table, and the roster is not silent when nothing matches: with this row commented out,
 * `route plan --question "what does the signed DPA pdf actually say"` and
 * `--question "is that policy document a scan"` each came back requiring `drive` and nothing else — the
 * ONE door that provably cannot read a PDF at all, because `drive read` never downloads a binary file's
 * bytes. So the failure was never a refusal. A session asking what a document said was sent to the one leg
 * guaranteed to answer metadata, which is exactly the fluent-wrong-answer shape the SPEND finding
 * describes. With the row in place both questions require `attachments`.
 * Repro: comment out the entry in `./genericCapabilities.ts` and run either question again.
 *
 * A reader landing on a provider row should still learn that its own `--pdf` flag exists, and that is an
 * argument for a clause, never for the vocabulary — each verb's own flag help already carries it.
 *
 * ## A term is judged on what the word means HERE, not on what it means
 *
 * MEASURED by running an eleven-question battery through `route plan` twice, once with this row and once
 * without: the bare words `scan` and `scanned` REGRESSED a question that already worked.
 * `--question "what did the latest vulnerability scan find"` required `corpus` before this row and
 * required `attachments` and nothing else after it — the corpus leg displaced outright, so a session
 * asking what a scan found was sent to extract the text of a document. In this build `scan` is
 * `atlas vanta vulnerabilities`, `github vuln` and the hygiene gate far more often than it is a
 * photocopier. The document sense is the PHRASE `scanned document`, which cannot match
 * `vulnerability scan`, and that is the general rule: a one-word term is only this row's if the word
 * means a document HERE. Adding a term is a routing change, so measure it the same way.
 *
 * ## `sourceClass: "provider"`, and why `artifact` would have been a defect
 *
 * The extraction runs locally, which makes `artifact` tempting and wrong.
 * `../live/turn/proposalAsk.ts`'s `EXISTENCE_ESTABLISHING_SOURCE_CLASSES` excludes `artifact` deliberately,
 * on the line its own header draws: whether a leg reads the world OUTSIDE this Slopweaver process.
 * `artifact` is this INSTALLATION describing itself — `catalog`'s command surface, `audit`'s own record
 * counts, `identity-directory`'s built index. A colleague's policy, a vendor's contract and an auditor's
 * report are none of those. Classing this row `artifact` would tell `classifyProposalAsk` that the one leg
 * able to establish whether a named thing exists in a document cannot, which is exactly the error that file
 * was written about when `catalog` was offered as an existence leg.
 *
 * Whose world the bytes describe is the question the field answers; that the parser runs on this machine is
 * how they are read. `atlas` is the one class with a side effect — `./atlasReading.ts`'s `atlasPlatformOf`
 * suppresses a derived row — and this row is not that.
 *
 * ## The write half is a HAND-OFF, never this row's `effect`
 *
 * MEASURED: no row in the table declares `effect: "write"`. That is not an omission to correct in passing —
 * `./sourcePlan.ts` ranks READING legs for an investigation, so a write row would be offered as somewhere to
 * go and LOOK. The attaching verbs are named in `coverage.detail` instead, which is the text
 * `../live/turn/briefCapabilityContracts.ts`'s `renderCapabilityContracts` actually prints, so a session
 * reading the roster learns both halves exist and which verb is which. Whether the table should express write
 * capability at all is a real question and a schema one; it is not settled here.
 */
import { type SourceCapability } from "./profile.js";

/** The DOCUMENT-WORDS leg: what a file a door already serves says, and the three places it cannot reach. */
export const ATTACHMENTS_CAPABILITY: SourceCapability = {
  availability: { kind: "available" },
  // A SCOPE read, for the reason the `drive` row gives: there is no question to substitute here at all,
  // because reading a document needs an ADDRESS — a Slack file id, a Linear identifier, a Notion url, a
  // local path. `pdf check` settles what this host's reader can do without opening anything: it prints the
  // per-document byte ceiling, the default page cap and, in its own words, that it is not OCR.
  // Repro: `slopweaver pdf check`.
  command: ["slopweaver", "pdf", "check"],
  coverage: {
    detail:
      "whether this host's text extractor loads, and the two ceilings it holds. The READING is the " +
      "separate act, and it is per-provider: `slopweaver slack read-file <F…>` and `slack read-thread " +
      "<link>` carry a Slack file's text inline, `slopweaver linear read <id> --pdf` and `slopweaver " +
      "notion read <url> --pdf` open the files those objects address, `slopweaver atlas vanta read --kind " +
      "policy-document --query <words>` searches the stored policy bodies and names a `textState` per " +
      "resource, and `slopweaver pdf read <path>` reads any local file. Gmail is TWO HOPS — `gmail " +
      "attachment <message-id> --name <file>` saves the bytes, then `pdf read` on that path — because the " +
      "mail read itself carries only the filename. Three things this leg CANNOT do, so never substitute a " +
      "guess for one: there is no OCR anywhere, so a scanned document is reported as having no text layer " +
      "and its words are genuinely unavailable rather than merely unread; a PDF held in Google Drive is " +
      "unreachable, because `drive read` never downloads a binary file's bytes at all and answers metadata " +
      "only; and GitHub serves no document read. Finding WHICH message, issue or page holds a file is the " +
      "provider's own row, never this one. ATTACHING a document is the other direction and its own act: " +
      "`slopweaver linear attach upload --file <path>` puts one in Linear's asset storage and prints the " +
      "block that embeds it, `slopweaver write vanta upload-evidence` files one against a Vanta control, " +
      "and `slopweaver notion attach` uploads a markdown body's local images and PDFs into Notion's own " +
      "storage, each at the position its placeholder was written — a `pdf` block `notion read --pdf` " +
      "then reads back",
    kind: "bounded",
  },
  effect: "read",
  freshness: {
    detail:
      "the document is fetched and parsed when the planned command runs, so a Slack, Linear, Notion or " +
      "local read is live. The Vanta policy bodies are the exception and are the generation the last " +
      "`atlas vanta sync` stored, so state that generation's age rather than implying live",
    kind: "live",
  },
  id: "attachments",
  owner: "slopweaver",
  sourceClass: "provider",
  terms: [
    "pdf",
    "pdfs",
    "attached document",
    "attached file",
    "document text",
    "what does the document say",
    "what does the file say",
    "read the pdf",
    "extracted text",
    "text layer",
    "scanned document",
    "page count",
    "policy document",
  ],
  truthMode: "current",
  what: "what a document a provider's door already serves actually SAYS — the extracted text and page count of a file attached to a Slack message, a Linear issue, a Notion page or a Vanta policy, never OCR of a scan and never which message carried it",
};
