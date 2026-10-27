# Project skill routes

Use exact installed skill identifiers and read selected skills before acting.
The baseline follows installed `for-ai` and its
`references/skill-composition.md` and `references/agents-inc-composition.md`.
Its `references/toolkit-provenance.json` records reviewed upstream revisions;
this repository routes those skills rather than copying their bodies. Missing
skills or tools need an explicit bounded fallback, not an unreviewed install.

## Baseline

| Responsibility | Route and project application |
| --- | --- |
| Shell-output efficiency | `rtk`: use supported compact output; keep instructions, editing reads, parsers, hashes, and exact verification raw. Check the executable once per host. If unavailable, use scoped `rg`, bounded native output, and original exit codes. |
| Lifecycle and continuity | `gsd-core-workflow`: [PROJECT.md](PROJECT.md) owns this change's goal, checklist, evidence, and handoff. If future work adopts `.planning/`, use `gsd-progress` / `gsd-resume-work` and link its owner instead of duplicating state. |
| Focused engineering | `superpowers-using-superpowers` selects relevant `superpowers-*` practices; `superpowers-workflow` provides the focused workflow. Reuse agreed decisions, the active plan, and existing execution authorization. |
| Small implementation scope | `ponytail`: reuse existing signal, controller, game, and UI owners; introduce an abstraction or dependency only for a current requirement. |
| Completion evidence | `superpowers-verification-before-completion` plus [VERIFICATION.md](VERIFICATION.md): distinguish local tests, browser checks, hardware, remote revision, and deployment. |

RTK's skill is installed, but neither its command nor its documented Windows
binary path was available during this update. Bounded native output is the
current fallback; recheck on another host. RTK is an agent tool, never a product
dependency. No hook, telemetry, proxy, updater, or alternate agent harness is
required to apply this baseline.

Use `superpowers-systematic-debugging` for defects and
`superpowers-test-driven-development` for behavioral code with a meaningful
regression check. Use `superpowers-brainstorming` / `superpowers-writing-plans`
when a design or implementation plan is needed, within the existing state
owner. Use the matching review and branch-integration skills when applicable.
Do not repeat completed planning or checks without a changed input or unresolved
risk. Delegation requires applicable authorization and disjoint ownership;
listing `superpowers-dispatching-parallel-agents` or
`superpowers-subagent-driven-development` is not automatic permission to spawn.

## Task-specific routes

| Task | Selected skill and boundary |
| --- | --- |
| Text-bearing HTML/CSS, including Systole menus and HUD | `uncodixfy-pretext` with `ponytail`; use real `@chenglou/pretext` measurement for touched bounded text and reuse `src/ui/pretext-fit.ts` where suitable. `uncodixfy` is an optional visual reference. Preserve the game's identity. |
| HTML controls, labels, keyboard, focus, announcements | `agents-inc-accessibility`; combine semantic and rendered checks with Pretext in one matrix. |
| A bounded panel that must stretch without internal scrolling | `uncodixfy-pretext` → `references/accordion-stretch.md`; preserve anchors, minimum readable type, order, and full-text access. Ordinary pages retain document flow. |
| Measured browser performance issue or explicit budget | `agents-inc-web-performance`; profile the actual Three.js/browser workload before changing it. |
| Evaluation of MobX or a real MobX boundary | `mobx-integration`; optional adoption only. Preserve vanilla TypeScript and existing owners unless the requested change justifies migration. Keep frame-critical simulation out of observables without evidence. |
| BRSP phone/controller or semantic remote protocol work | `browser-remote-sync-protocol`; preserve the project's protocol and authority contracts. |
| Existing native app under `apps/breath-mirror-native/` | `tauri-rust-developer`; use `tauri-remote-app-builder` only for an authorized integrated app/CLI/companion change. Browser Systole work does not require native migration. |
| Web research, public facts, upstream code, or asset comparison | `multi-source-web-search`; choose Fast, Grounded, Deep, or GitHub/Docs mode, open primary sources, check blind spots for non-trivial questions, and cite the evidence. |
| New or edited raster assets | `imagegen`; retain provenance and follow the requested visual direction. Do not replace an asset or license check with an image-generation claim. |

This remains a TypeScript, Three.js, Vite project. Skill installation does not
authorize adding frameworks or runtime dependencies. Preserve shared Polar
acquisition, readiness, signal privacy, controller, and flight boundaries.
Record licensed external assets in [third-party notices](../THIRD_PARTY_NOTICES.md)
with source, author, license, and any pinned revision or conversion. Keep original
license files. Unclear redistribution rights block shipping that asset; research
and source inspection do not establish rights by themselves.
