# Atelier Aurelia Studio — Product Requirements Document

## 1. Product definition

Atelier Aurelia Studio is a private AI-native digital-product factory. A user begins with a rough idea and ends with a finished, visually coherent, printable + digital product, complete marketplace assets, and a verified Etsy draft.

The system is not a planner generator. It must be capable of inventing and manufacturing many classes of digital products without adding a new coded aesthetic or product template for each concept.

### North-star experience

The user should experience only two meaningful gates:

1. **Creative commitment:** brainstorm until satisfied, then click **Build Product**.
2. **Commercial approval:** inspect the finished product and click **Approve**, then explicitly **Send to Etsy Drafts**.

The autonomous middle performs planning, design, generation, rendering, critique, repair, packaging, listing production, and QA.

## 2. Non-goals

- No hard-coded catalog of aesthetics, niches, or product families as the creative engine.
- No requirement for the user to edit JSON, run scripts, use GitHub, or know internal taxonomies.
- No automated Etsy live publishing.
- No arbitrary provider payload submission.
- No raster-only full-page generation for precision-heavy pages where exact text/layout is required.
- No silent overwriting of prior revisions.

## 3. Primary user workflow

1. Open private Atelier Aurelia Studio.
2. Enter a rough idea conversationally.
3. Optionally paste inspiration links and upload reference images.
4. Creative Director proposes differentiated directions and refines the chosen concept.
5. Studio shows an inspectable concept card: customer, product promise, visual direction, expected structure, deliverables.
6. User clicks **Build Product**.
7. A durable background workflow produces the product without depending on the browser remaining open.
8. Studio presents a finished review workspace with all pages, customer files, listing media, listing copy, QA, and version history.
9. User can request targeted natural-language changes at product/page/asset/listing scope.
10. Each change creates a new revision and regenerates only dependent outputs.
11. User approves an exact release.
12. User explicitly chooses **Send to Etsy Drafts**.
13. Etsy adapter preflights exact approved bytes + metadata, creates/resumes the draft idempotently, uploads, reads remote state back, verifies it, and records a receipt.
14. Studio displays the Etsy draft state and link.
15. User publishes manually inside Etsy.

## 4. Core product surfaces

### 4.1 Studio
Conversational creative workspace. Supports idea text, inspiration URLs, uploads, concept alternatives, concept refinement, and Build Product.

### 4.2 Products
Persistent library with status, current revision, generation progress, Etsy state, and searchable history.

### 4.3 Product workspace
Tabs:
- Product: page grid/fullscreen page review.
- Listing: marketplace images + listing metadata.
- Files: final customer downloads and internal artifacts.
- QA: structural/visual/content/marketplace checks.
- Etsy: draft readiness, preflight, remote receipt/status.
- History: revision graph, diffs, restoration.

### 4.4 Settings
Secure provider connections, Atelier Aurelia brand preferences, shop configuration, Etsy capability snapshot state, and retention/export controls.

## 5. AI creative pipeline

### 5.1 Creative Director
Turns vague input into multiple distinct product concepts. It does not select from a fixed catalog.

### 5.2 Product Architect
Creates a domain-neutral ProductSpec including target customer, product purpose, architecture, stable page IDs, deliverable plan, digital/print requirements, and content dependencies.

### 5.3 Art Director
Creates Visual DNA: mood, palette, typography direction, illustration/image direction, geometry, whitespace, texture, motifs, and avoidances.

### 5.4 Layout Designer
Produces declarative page designs from composable primitives. Product type is data, not code.

### 5.5 Image generation
Creates artwork, illustrations, decorative assets, textures, backgrounds, and scene imagery. Exact text, tables, checkboxes, grids, dimensions, pagination, and precision layout remain deterministic.

### 5.6 Design Critic + Repair Agent
Evaluate actual renders. Return defects tied to stable page/asset IDs. Regenerate only affected graph nodes unless a product-level change requires broader propagation.

### 5.7 Listing Art Director + Copywriter
Operate only after verified product facts exist. Listing assets use actual rendered product pages composited into generated or deterministic scenes rather than hallucinated fake planner/page contents.

## 6. Structured source of truth

Every meaningful object has a stable ID and version/provenance metadata:
- product
- revision
- creative brief
- ProductSpec
- Visual DNA
- page
- page element
- generated asset
- render
- customer deliverable
- listing image
- listing metadata revision
- QA finding
- approval
- release seal
- Etsy operation + receipt

The final preview, customer deliverables, listing assets, and marketplace release must descend from the same approved revision lineage.

## 7. Rendering architecture

Use composable primitives such as text, image, rule, box, table, checkbox, writing lines, grid, frame, icon, header, footer, quote, and divider.

AI decides composition and design intent through structured specs. The deterministic renderer converts these specs into exact pages and exports.

Minimum initial outputs:
- US Letter PDF
- A4 PDF
- tablet/iPad PDF where product-appropriate
- per-page PNG previews
- customer ZIP/package when needed
- marketplace listing imagery

Digital features such as hyperlinks/tabs are product capabilities, not mandatory universal assumptions.

## 8. Editing and revision graph

Natural-language edits may target:
- entire product
- Visual DNA
- page range
- one page
- one asset
- content block
- listing image
- listing metadata

A change must:
1. resolve target IDs,
2. create a new immutable revision,
3. compute dependent nodes,
4. regenerate only required outputs,
5. rerun relevant QA,
6. preserve all prior revisions.

Never mutate an approved release in place.

## 9. Durable jobs

Generation must survive browser closure and process restarts. Jobs require persisted state, attempts, retry classification, cancellation, progress events, error summaries, and human escalation for ambiguous external side effects.

Target conceptual stages:
brief → specification → visual DNA → asset plan → asset generation → page design → rendering → visual QA → repair loop → packaging → listing media → listing copy → marketplace QA → ready for review.

## 10. Storage

### Database
Structured truth: users, shops, products, conversations, revisions, specs, jobs, QA, approvals, listing metadata, provider operations, audit events.

### Object storage
Immutable large artifacts: uploads, generated images, rendered pages, PDFs, ZIPs, listing images, exports.

### GitHub
Code, schemas, prompts, tests, migrations, infrastructure definitions. Generated customer products do not live in Git.

## 11. Approval + release sealing

Approval binds to an immutable revision. Release sealing captures exact artifact content hashes and exact listing metadata hash. Any later change invalidates the prior release for submission purposes and creates a new candidate.

## 12. Etsy boundary

Etsy is a marketplace adapter, not the universal product model.

Required behaviors:
- secure OAuth/credential handling;
- shop-bound capability/taxonomy snapshot with freshness;
- provider-specific late validation;
- explicit approved release requirement;
- second explicit confirmation to create Etsy draft;
- exact-byte preflight immediately before remote action;
- deterministic idempotency/operation IDs;
- durable operation journal;
- safe handling of uncertain writes;
- remote read-back and comparison;
- immutable receipt;
- no live publish capability anywhere in the system.

## 13. Inspiration and provenance

Inputs may include URLs and user uploads. Store source, capture time, user notes, consent/provenance metadata, and derivation relationships. Inspiration should be distilled into principles, not copied. URL retrieval and uploads must be treated as untrusted input.

## 14. QA

QA families:
- schema/contract
- product completeness
- content consistency
- visual hierarchy/coherence
- clipping/overflow
- typography/legibility
- print margins
- image quality
- dimensions/page order
- accessibility where applicable
- packaging/ZIP safety
- provenance/license state
- listing factual consistency
- marketplace constraints
- exact release integrity

QA results are machine-readable and linked to target IDs so repair can be selective.

## 15. Security

- authenticated private application;
- per-user/shop/project authorization;
- server-side encrypted secrets;
- no secret values in logs/client bundles;
- signed/authorized artifact access;
- upload validation + scanning/isolation plan;
- SSRF-safe remote reference retrieval;
- immutable audit log for approvals/provider writes;
- CSRF/session/rate-limit controls;
- dependency lock + vulnerability/secret scanning in CI;
- no arbitrary filesystem paths or marketplace payloads.

## 16. Brand Library

Allow the user to save approved visual principles, palettes, motifs, typography directions, reusable assets, mockup approaches, and explicit dislikes to an Atelier Aurelia brand library. This is a preference/reference layer, not a rigid template catalog.

## 17. Success criteria

The architecture succeeds when:
- a new product aesthetic can be created without adding code for that aesthetic;
- a new digital-product concept can usually be represented as data/specs + primitives rather than a new renderer;
- the user can build/review/edit without Codex/terminal/GitHub;
- one bad page can be fixed without rebuilding unrelated pages;
- generated jobs survive browser closure;
- approved bytes are exactly the bytes sent to Etsy;
- Etsy side effects are safe, resumable, auditable, and draft-only.
