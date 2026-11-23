# How this was harvested

Part of [What the owner wants from the corpus — harvested from the owner's own voice](../corpus-intent.md).

|              |                                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source       | `~/Documents/superwhisper/recordings/<unix-ts>/meta.json` → `result`                                                                                                                           |
| Corpus       | **3,283** recordings carrying a transcript, about twelve weeks of them, 3.42M characters — the last of them is the owner's reaction to this document ([§11](11-owner-reaction-and-answers.md)) |
| Matched      | **332** on world-model / retrieval / corpus / atlas / dynamic-workflow terms                                                                                                                   |
| Read in full | **~210** — the 100 densest, plus 101 filtered on the tight retrieval vocabulary, plus 49 on dynamic-workflow / adversarial / omniscient / unknown-unknown, plus 8 on belief-layer / recency    |
| Not read     | ~80, which matched only incidental terms (`citation` in a PR-format context, `search` in a Slack context) and no world-model vocabulary                                                        |

Each requirement is stated as the owner's intent rather than as a quotation, and keeps the owner's hedges: where the
owner was unsure, the text says so, because tidying a hedge away makes the owner sound more decided than they were.
The recording's unix timestamp is its directory name, so any claim is checkable against
`~/Documents/superwhisper/recordings/<ts>/meta.json`.

**Every person, bot and organisation is replaced by a bracketed role** — `[the bot]`, `[a leader]`,
`[a colleague]`, `[the incumbent bot]`. The unredacted originals are
in the recordings themselves and in the handover docs under `$SLOPWEAVER_HOME`, neither of which is committed. Under
[the partition](../constraints/partition.md) the names are content and this repo owns shape, so the
substance survives the redaction intact — which role said a thing is what the argument turns on, never
which name.

---

## The three problems, kept apart

The owner separated these personally and asked that they not be conflated. Everything below sits under one of them.

|       | Problem                                                                                            | What the owner wants                                                                                      | Status                                                                                                                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** | **Plumbing** — the semantic half of retrieval has never run                                        | The semantic half fixed, since it has never run well on this machine                                      | **DISSOLVED by the owner's retrieval ruling ([hard constraint 1a](../constraints/hard.md#1a-retrieval-is-postgres-full-text-over-the-store-nothing-else))** — there is no semantic half; the owning doc is settled |
| **2** | **Shape** — even with retrieval working, the answer may still be worse than asking Claude directly | An answer at least as good as asking Claude the question directly, which the owner suspects is far better | **This document's subject.** Unowned                                                                                                                                                                               |
| **3** | **Trust** — the answer must be faithfully accurate, not made to look accurate                      | Answers that are faithfully, highly accurate — never fabricated to look accurate and win approval         | Blocks the `org-world-model-sensitive-sources` proposal                                                                                                                                                            |

---
