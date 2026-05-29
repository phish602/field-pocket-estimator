# ESTIPAID CONTEXT

## Project identity
- Project name: **EstiPaid**
- Product type: React SaaS app for estimates, invoices, customers, and financial tracking
- Product mantra: **"I barely knew how to explain the job, but the app helped me turn it into a legitimate estimate."**
- Motto: **"Turn Scope into Revenue."**
- Default local app URL: `http://localhost:3000/`

---

## Core operating mode
- Treat this file as the long-form baseline for EstiPaid work
- Do not ask me to restate stable project history unless the current task truly depends on it
- Use **one objective per prompt**
- Use **one engine per pass**
- Only mention **changed constraints**
- Reference **current file behavior** instead of retelling old prompt history
- Do not bundle **review + implement + redesign + harden** into one prompt
- Keep responses concise and technical
- Default to token-efficient workflow across chats

---

## Default prompt seed
Use this default structure when generating EstiPaid prompts:

EstiPaid default mode:
Assume ESTIPAID_CONTEXT.md is the baseline.
Use token-efficient workflow.
One objective per prompt.
One engine per pass.
Modify only listed files.
Keep scope minimal.
Preserve structure.
Do not refactor unrelated code.
Use current file behavior over retelling project history.
Only ask for missing context if the task truly depends on it.

---

## Response rules
- Follow my instructions exactly
- Do not reinterpret the task
- Do not expand scope
- Do not refactor unrelated code
- Preserve existing structure unless explicitly told otherwise
- If something is unclear and truly blocks correctness, ask a short clarifying question
- If a file must change, return the **full updated file** unless I ask for a patch
- Do not return partial snippets unless requested

---

## Engine priority

### Logic engine
- Codex = primary logic engine

Use Codex for:
- feature logic
- behavior
- state
- routing
- storage
- estimator/invoice logic
- modal flows
- AI prompt shaping
- provider logic
- fallback logic
- normalization
- validation
- writeback logic

### UI engines
- Claude = primary UI engine
- Copilot = secondary / backup UI engine

Use UI engines for:
- CSS
- spacing
- labels
- hover states
- empty states
- accessibility
- containment
- tile styling
- responsive polish
- visual cleanup

### Separation rule
- Never let logic and UI engines modify the same file in the same pass unless the change is pure CSS/visual only

---

## File modification rules
- Only modify files I explicitly list
- Keep scope minimal
- Preserve existing structure
- Do not touch unrelated files
- Do not change desktop/web behavior unless I explicitly ask
- Protect mobile behavior from regression
- Do not silently remove existing logic
- Do not send stripped-down replacements

---

## Product design baseline
- Dark theme
- Glass panels
- Rounded components
- Premium SaaS look
- Consistent spacing and containment
- Shared UI should feel like one system
- Avoid unnecessary redesigns
- Improve clarity and usability without changing product identity

---

## Stable UX baselines
- Home page hero logo position is locked as baseline
- Only the logo moves on the Home page hero
- Hero title and slogan remain fixed
- Mobile builder/edit action bar behavior must not regress
- Bottom-nav visibility behavior must not regress
- Do not move builder/edit action bar into a floating redesign unless explicitly asked
- Footer action rows should feel like one shared UI system
- Avoid overlay / floating footer-row bugs
- Remove redundant Back buttons where footer nav already covers navigation
- Prioritize mobile saved estimate/invoice readability
- Keep desktop unchanged unless explicitly asked

## Product polish baseline
- Treat the saved Customers, Projects, Project Detail, Estimates, Invoices, and Company Profile UI/copy cleanups as protected baseline behavior.
- Do not revert the inactive invoice value filter removal, Customers empty-state polish, Project Detail Danger Zone cleanup, Company Profile naming/copy updates, Estimates copy polish, Projects copy polish, or Invoices copy polish in future passes.
- Preserve these as intentional UI/copy baselines unless a future task explicitly targets them.

---

## App architecture baseline
- EstiPaid namespace is isolated
- Use EstiPaid-only storage keys
- FieldPocketEstimator has been removed from routing baseline
- App routing baseline is locked unless explicitly changed
- EstimateForm baseline structure should be preserved unless explicitly targeted
- Manual form remains the **source of truth**

---

## Guided Build baseline
- Guided Build is an additive overlay on top of the estimator/invoice builder
- It does **not** replace the manual form
- Manual form remains source of truth
- Deterministic/local logic should resolve obvious steps instantly
- AI should only be used for truly interpretive turns
- Prevent duplicate AI calls
- Do not call provider if local logic already resolved the step
- Never leak raw provider/backend errors into visible guided UI
- Show a visible thinking state during real AI turns
- Primary surfaced driver should be the active blocker/prompt, not random secondary state
- Customer input/state is supporting context for validation and repair, not the primary surfaced step unless it is actually the blocker

---

## AI assist product direction
- AI Assist is an equalizer, not a gimmick
- AI should help contractors turn vague scope into usable estimate language
- AI should feel guided, practical, and contractor-friendly
- Local writeback and field logic stay deterministic
- AI suggests; local logic writes back
- Keep the UI simple
- Per-section AI assist is preferred over overbuilt chat complexity unless explicitly requested

---

## Scope notes / AI writing direction
When generating or refining contractor-facing scope language:
- Prefer verb-led output
- Make notes sound legitimate, practical, and commercially usable
- Expand vague user input into realistic contractor-ready scope
- Preserve specificity when present
- Do not inflate narrow tasks into full replacement unless warranted
- Favor intelligent combinations of actions, methods, and objects
- Use trade-aware vocabulary and terminology
- Avoid empty fluff or generic phrasing
- The result should sound like something that belongs on a real estimate

---

## Current workflow defaults
When I ask for repo help:
- Start with a short direct diagnosis
- Then provide the prompt or file output cleanly
- Keep the task tightly scoped
- Mention the engine for the pass
- Include exact files allowed
- Include exact files blocked
- Include acceptance criteria

---

## May 28, 2026 — Actionable Test Baseline
- Build passes cleanly.
- 44 of 45 test suites are currently actionable-clean.
- 1642 of 1642 actionable tests pass.
- No open-handle diagnostics were reported in the final actionable run.
- `src/server.devAi.stripeCheckoutConnect.test.js` is intentionally excluded for now because Stripe checkout/connect is still in build status.
- The Stripe suite should be tested later by running it alone first, then against the clean actionable baseline after Stripe work resumes.
- Do not treat the excluded Stripe suite as a cleanup blocker.
- Current clean actionable baseline excludes only:
  - `src/server.devAi.stripeCheckoutConnect.test.js`
- Future cleanup/product work should start from this 44-suite actionable baseline unless Stripe work is the active task.

---

## Preferred task prompt format
Use this structure for new work:

EstiPaid default mode:
Assume ESTIPAID_CONTEXT.md is the baseline.
Use token-efficient workflow.
One objective per prompt.
One engine per pass.
Modify only listed files.
Keep scope minimal.
Preserve structure.
Do not refactor unrelated code.
Use current file behavior over retelling project history.
Only ask for missing context if the task truly depends on it.

[Engine] pass.
Objective: [one objective only]
Files: [exact files allowed]
Do not touch: [exact files blocked]
Acceptance:
- [result 1]
- [result 2]
- [result 3]

---

## PDF / export rules
- Additional Notes should render on estimate and invoice PDFs **only when the trimmed field is non-empty**
- Do not export empty Additional Notes sections
- Preserve existing PDF structure unless explicitly asked to change it
- Avoid layout regressions in totals, headers, company info, and page flow

---

## Storage / persistence rules
- Preserve EstiPaid storage separation between estimates and invoices
- Do not introduce namespace collisions
- Do not break migration/cleanup baselines
- Be careful with saved object structure changes
- Prefer backward-safe changes unless explicitly told otherwise

---

## Mobile protection rules
- Mobile estimator flow is fragile and high priority

---

## Codebase Boundaries / Cleanup Rules
- `src/EstimateForm.js` is still large, functional, and protected.
- Safe extracted utilities now include:
  - `src/utils/customLaborRoles.js`
  - `src/utils/estimatorCustomers.js`
  - `src/utils/scopeTradeStarters.js`
- Protected zones:
  - AI Assist
  - save/export flow
  - PDF payload shaping
  - scope images
  - project linking/reassignment
  - storage writes/reads
  - Guided Build
- Future refactors must proceed one utility/component boundary at a time.
- No broad `EstimateForm` rewrite.
- No behavior cleanup without tests.
- Prefer an audit-only pass before each extraction.
- Do not introduce tap misroutes
- Do not let fixed nav or footer layers interfere with form controls
- Protect builder/edit screens from footer/nav hit-area regressions
- Keep action bars and nav behavior consistent and intentional

---

## Change discipline
Before making changes:
- Identify the exact behavior being changed
- Limit changes to the listed files
- Preserve stable baseline behavior outside the task
- Do not do side cleanups
- Do not opportunistically redesign unrelated areas

After making changes:
- Verify the requested behavior is fixed
- Verify no obvious regressions in nearby flow
- Verify acceptance criteria are met
- Stop when the requested task is done

---

## What not to do
- Do not retell full project history in every prompt
- Do not combine multiple objectives into one pass
- Do not let two engines fight over the same file
- Do not redesign UI when I asked for logic only
- Do not alter logic when I asked for UI only
- Do not change files I did not list
- Do not silently broaden scope
- Do not give me placeholder implementations

---

## New chat instruction
In a new EstiPaid chat, assume this file is the baseline.
Only ask for missing context if the current task truly depends on it.
Default to token-efficient workflow.

---

## Optional live task note section
Use this section only for current short-term active work.
Delete or refresh it when priorities change.

### Current priority
- [fill in current active objective]

### Active files
- [fill in]

### Do not touch this pass
- [fill in]

### Acceptance criteria
- [fill in]

---

## Optional architecture snapshot
Update this only when the baseline truly changes.

### Core files
- `src/EstimateForm.js`
- `src/pdf.js`
- `src/screens/EstimatesScreen.js`
- `src/screens/InvoicesScreen.js`
- `src/screens/FinancialSnapshotScreen.js`
- `src/screens/CompanyProfileScreen.js`
- `src/estimator/engine.js`
- `src/estimator/guided/*`
- `src/estimator/aiAssist/*`
- `server/dev-ai.js`

### Notes
- Add stable architecture notes here only when they become long-term baseline
- Do not dump temporary bug notes here

---

## Quick prompt examples

### Codex logic pass
- Engine: Codex
- Objective: fix duplicate AI submit in guided scope notes
- Files: `src/estimator/guided/useGuidedBuild.js`, `server/dev-ai.js`
- Do not touch: UI files
- Acceptance:
  - one submit per user action
  - no duplicate provider calls
  - current guided flow preserved

### Claude UI pass
- Engine: Claude
- Objective: improve saved invoice card readability on mobile
- Files: `src/screens/InvoicesScreen.js`, relevant CSS file only if needed
- Do not touch: estimator logic, routing, storage
- Acceptance:
  - improved readability on narrow screens
  - no desktop regression
  - no tile redesign beyond requested polish

### Copilot backup UI pass
- Engine: Copilot
- Objective: tighten spacing and containment on saved estimate cards
- Files: relevant screen file and CSS file only if needed
- Do not touch: estimator logic, routing, storage
- Acceptance:
  - tighter spacing and cleaner containment
  - no mobile regression
  - no logic changes
