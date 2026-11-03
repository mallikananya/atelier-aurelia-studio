# CE-03C.2 — Local inference verification

## Scope and evidence

The authoritative requirements remain `docs/PRD.md`. This milestone installs and verifies local creative planning only. It does not implement AI-authored page composition, change CE-03A/CE-03B contracts/rendering, approve a product, or send anything to Etsy.

Official macOS distribution: https://ollama.com/download/Ollama-darwin.zip. Installed at `/Applications/Ollama.app`; universal binary includes arm64 and passed `codesign --verify --deep --strict`. Version: **0.40.13**. Hardware: Apple M5 Pro, 48 GB unified memory. Available disk before download: approximately 683 GiB.

Model: **qwen3:14b**, **14.8B**, **Q4_K_M**, GGUF, **9,276,198,565 bytes** (9.276 GB / 8.639 GiB). Exact manifest digest:

```
bdbd181c33f2ed1b31c972991882db3cf4d192569092138a7d29e973cd9debe8
```

Only this model was installed. The existing unrelated working-tree changes in `docs/IMPLEMENTATION_STATUS.md`, `docs/CE-03C.1_DIAGNOSIS.md`, and `infra/aws/README.md` were preserved.

## Local service and configuration

A user LaunchAgent at `~/Library/LaunchAgents/com.atelier-aurelia.ollama.plist` starts the official binary with `serve`, restarts it on failure, and loads at login. Its environment sets `OLLAMA_HOST=127.0.0.1:11434`, `OLLAMA_NO_CLOUD=1`, and `OLLAMA_NUM_PARALLEL=1`. Logs: `~/.ollama/logs/aurelia-server.log`; model storage: `~/.ollama/models`. Logs confirm cloud disabled and loopback binding. Do not launch a competing GUI server on the same port.

The eight requested `PLANNING_*` settings were updated in the ignored `.env`, preserving unrelated lines. Provider mode is live, URL is loopback `/v1/chat/completions`, model is qwen3:14b, expected cost is zero, maximum tokens is 6000, and timeout is 300000 ms per attempt. The API-key placeholder is local and not a paid credential. No cloud inference, paid API, extra model, database reset, migration, or volume deletion was used. The inference verification phase made no commit or push.

The CLI is available at `/Applications/Ollama.app/Contents/Resources/ollama`; no unrelated PATH configuration was overwritten.

## Adapter compatibility and retries

Two sequential real wire-format probes showed a silent compatibility defect: `max_completion_tokens: 1` returned **363 completion tokens**, whereas `max_tokens: 1` returned **1** with finish reason `length`. The first probe took 65.589 seconds, the second 0.128 seconds. HTTP success alone would have missed the ignored token cap.

Minimal adapter changes recognize only HTTP literal loopback (`127.0.0.1` or `[::1]`), port 11434, path `/v1/chat/completions`: permit an explicit timeout up to 300000 ms, use `max_tokens`, and send `response_format: {type: "json_schema", json_schema: {name: "creative_plan", strict: true, schema: ...}}` using the existing `CreativePlanV1` JSON Schema. This local-only constrained decoding correction was justified by the real JSON-object-mode failures below. Other endpoints retain `json_object`, `max_completion_tokens`, and the 30000 ms ceiling. All default timeouts remain 30000 ms. Redirect rejection, bounded response reads, sanitized errors, and abort behavior remain intact.

The existing planning service makes at most three **sequential** attempts. Invalid JSON, schema/reference failures, and oversized generated text trigger repair with existing diagnostics/previous-output handling. Network failures, HTTP errors, and timeouts stop immediately as provider failure; they are not retried. Five minutes is an upper bound, never a deliberate delay. Three full schema-failing attempts could take approximately 15 minutes; a single transport timeout does not cause that sequence. One Ollama inference slot prevents concurrent execution, but does not add application-level deduplication.

**Existing persistence limitation:** planning reservations expire after 120 seconds in `202610290001_ce021_planning_security.sql`. Longer successful inference can fail to save, and reservation expiry can admit another request. This milestone does not change that persistence contract. The live benchmark exercises the real provider and `planProduct` service, without writing a product revision to the database; browser regressions separately use their existing labeled test double. Successful schema validation must not be represented as a verified long-running UI save.

## Thinking and context

`/api/show` reports boolean thinking support with default **true**. The application sends no thinking override, so the default is retained. Ollama documents native `think: false` and OpenAI-compatible `reasoning_effort: "none"` for disabling thinking; these are not enabled in application configuration. Reasoning and final JSON are separate response fields. No token-limit increase was made. The server selected a 32768-token context automatically; the model metadata reports 40960 maximum context. Longer reasoning is not evidence of better visual quality.

Sources: [macOS support](https://docs.ollama.com/macos), [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility), [local-only mode](https://docs.ollama.com/faq), [model](https://ollama.com/library/qwen3:14b).

## Verification results

**Status: CE-03C.2 local inference acceptance criteria met.** The schema-constrained run completed normally on November 2, 2026, at approximately 23:13:53 Pacific; it was not interrupted. Inspection and saved-output revalidation on November 3 found the server still listening only on 127.0.0.1:11434, with no active inference and the model unloaded after idle expiry. No installation, download, baseline experiment, or inference was repeated during this continuation.

The live harness called `getPlanningProvider()` with the ignored `.env`, then the existing strict `planProduct` application service with the owner's exact brief, fresh identities, and no supplied source references. It used real HTTP/model output; only the `server-only` import marker was stubbed for the test runtime. It made sequential calls, retained raw responses and repair diagnostics, and did not persist a product revision. Both final envelopes pass strict schema, identity/reference, deliverable coverage, page-order, and dependency validation. A subsequent **offline replay of those exact unedited model responses through `planProduct`** reproduced both complete envelopes identically; no model request was needed for revalidation.

| Constrained run / attempt | Response time | Prompt tokens (cached) | Completion tokens | Generation throughput | Strict result |
| --- | ---: | ---: | ---: | ---: | --- |
| Cold / 1 | 222.736 s | 1533 (0) | 2136 | 10.02 tokens/s | Pass, 24 pages, no repair |
| Warm / 1 | 124.353 s | 1533 (1532) | 1622 | 13.05 tokens/s | Page-count mismatch |
| Warm / 2 | 130.871 s | 2802 (1521) | 1567 | 12.39 tokens/s | Pass, 5 pages, one repair |

End-to-end service time: **222.755 seconds cold**, **255.232 seconds warm including repair**. Warm completion tokens total 3189; prompt-token totals include cached/repeated context. Counts are Ollama usage values and include model reasoning in completion accounting, not just final JSON. Cold runner startup was **3.27 seconds** according to server logs; warm requests reused the loaded runner. Generation throughput comes from server `eval time` records, excluding prompt evaluation and load time; the Chat Completions responses did not expose a separate load-duration field. Prompt evaluation was 6.304 seconds cold, 0.050 seconds warm-first, and 4.252 seconds during repair. No constrained attempt timed out or exhausted the 6000-token budget.

The exact warm-first error was `plan.manifest.targetPageCount` / `custom` / **Page count mismatch**: targetPageCount was **48**, but pages.length was **5**. The existing service sent that diagnostic and previous output into attempt two. The actual model repair produced a valid five-page manifest; no remaining strict validation errors exist. This demonstrates why constrained decoding supplements, rather than replaces, application validation of relationships.

Approximate peak memory during the constrained run: **15,610,256 KiB (14.89 GiB)** combined Ollama server/runner RSS, sampled every five seconds; `/api/ps` reported **13,928,140,635 bytes (12.97 GiB)** model allocation. These are different accounting measures, not additive totals or an exact instantaneous peak. Earlier baseline peak combined RSS was about 15.62 GiB. Logs show **41/41 layers offloaded**, Metal on Apple M5 Pro; `ollama ps` reported **100% GPU**. The machine was also running other applications, so these are observed local measurements, not controlled hardware performance claims.

### Baseline failures retained

The earlier JSON-object runs remain evidence of a real limitation, not passing results. Cold took **689.331 seconds**, exhausted three attempts (220.542 / 293.223 / 175.534 seconds), and failed. Errors progressed from excessive/mismatched page count, non-contiguous order, and an extra root `id`, to just the extra `id`, then missing `manifest.pages[7].sourceIds` with an unsupported `source.getIds` field. Warm took **667.337 seconds**, exhausted three attempts (179.763 / 188.798 / 298.760 seconds), and repeatedly returned schema definitions instead of a creative-plan instance. No baseline attempt timed out; the last response arrived just before the limit. An intermediate progress message called it a timeout prematurely and was corrected after examining the saved response.

Baseline completion-token counts were cold **2300 / 3287 / 2092**, warm **1802 / 2148 / 2640**. Their corresponding prompt-token counts were **1533 / 3268 / 3190** and **1533 / 3251 / 3198**. No baseline response was manually repaired or substituted. The subsequent local-only JSON-schema format produced the successful results above without changing the brief, schema, thinking default, timeout, or token budget.

### Checks

- Focused provider/configuration/planning-service regression tests: **74 passed**, including **18 live-adapter tests**. New schema-format assertions were observed failing before implementation and passing after it; generic-provider behavior remains covered.
- Full coverage command: **passed**, including **393 Vitest tests across 29 files**, Node test suites, and workspace checks. Aggregate coverage: **97.79% statements, 95.54% branches, 96.00% functions, 98.67% lines**.
- Lint, typecheck, architecture guardrails, production build using the repository environment loader, and `git diff --check`: **passed** on the final adapter state.
- Existing planning browser regression suite: **7 passed** earlier in this task using its explicitly labeled local test double. This is regression evidence, not a real-model UI-save test; it preceded the final local-only schema mapping, which is covered by focused and real-model service tests.
- Production dependency audit: **zero vulnerabilities** in the completed task audit. The deferred 16 moderate development-tooling advisories were not overridden, suppressed, or upgraded.
- An earlier coverage run overlapping inference/build hit the unrelated PDF test's five-second timeout. The unchanged test passed in the completed suite with inference idle. An initial build without loading `.env` failed for missing NEXT_PUBLIC_APP_URL; the repository environment-loader build passed. No test thresholds were weakened.
- Independent read-only review found no actionable issues in the local-only mapping; persistence lease limitations remain documented above.

### Evidence and limitations

Ignored local evidence lives in `output/ce03c2/`: `models.json`, `model-info.json`, `probe-*.json`, baseline `cold*.json` / `warm*.json`, successful `schema-cold*.json` / `schema-warm*.json`, memory samples, and `saved-output-revalidation.json`. The latter records exact strict errors and identical final envelopes on replay. The live verification harness is retained there but should not be rerun merely to inspect results. Generated model responses and `.env` remain ignored, outside the committed source surface.

Successful creative planning is **not AI-authored page composition**. These two successful service runs are not a statistical reliability guarantee. The cold plan proposed 24 pages with ivory/burgundy-oriented Visual DNA; the warm plan proposed five pages and a purple/orange palette that drifts from the brief. Both schemas pass, but commercial/aesthetic suitability and semantic fidelity have not been established. Proposed deliverables also do not establish fulfillment of the PRD's eventual US Letter/A4/tablet PDF requirements. No ProductSpec/design contract was weakened, no renderer was changed, and no PDF/PNG customer product was generated by this milestone.

All eight local inference acceptance items are satisfied: installation/service, callable identified model, existing abstraction, five-minute configured timeout, real strictly valid creative plan, regression checks, documented identity/performance, and no paid/cloud inference. **Reliable long-running authenticated UI persistence remains outside that claim:** both successful service runs exceeded the existing 120-second reservation. Persistence and duplicate-admission behavior must be addressed in a separately scoped change before relying on this path for saved UI revisions.

**Next recommended CE-03C.3 step, not started:** use this verified local adapter to author one real declarative page composition against the existing CE-03A design contract, validate and render with CE-03B, retain exact model/provenance evidence, and submit the actual render for owner review. Address the reservation lifetime separately before integrating long-running generation into the saved UI workflow. Preserve PRD selective repair, deterministic rendering, owner approval, and Etsy draft-only boundaries. The inference verification phase made no commit or push; subsequent finalization was explicitly authorized on November 3, 2026.


## Finalization verification — November 3, 2026

Re-ran the full coverage command on the unchanged adapter: 393 tests across 29 Vitest files passed, along with Node/workspace checks and the existing coverage thresholds. Lint, typecheck, architecture guardrails, and the environment-loaded production build also passed. Finalization is scoped to this report and the two live-provider source/test files; pre-existing implementation-status, CE-03C.1 diagnosis, and AWS README changes remain excluded. The separate reservation-safety investigation is proposal-only and introduces no persistence changes.
