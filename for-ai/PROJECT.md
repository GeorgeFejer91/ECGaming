# ECGaming — active product contract

## Goal: publish Systole: The Quiet Vessel

Create a standalone ECG-powered spacecraft navigator at `/games/systole/` on the existing ECGaming website. Keep Polar Plane and its routes working. User authorization includes implementation, asset research, baseline guidance updates, focused commits, push, and publication after checks.

The existing TypeScript/Three.js/Vite runtime owns Polar acquisition, signal freshness, mapping/calibration, practice ECG, phone steering, remote sessions, music, CSV, and WebXR. Systole reuses these owners and the control document; its theme supplies a spacecraft catalog, space environment, UI presentation, and vessel-mesh collision effect. Never fork signal processing or silently simulate physical ECG.

Design: monumental suspended architecture, charcoal space, oxidized gold and muted cyan instruments, a scarlet anatomical heart inside a mechanical spacecraft. Original art evokes the requested Avorion / Disco Elysium / Superliminal atmosphere without copying their assets. Source blood-vessel meshes from a verified anatomy repository, retain attribution and licenses, and describe explosion motion as artistic.

## Active implementation checklist (single state owner)

- [x] Inspect latest source and isolate work from the older recovery checkout. Base `946a902`; managed worktree `systole-spacecraft/ECGaming`, branch `codex/systole-spacecraft`.
- [x] Update baseline `for-ai` routes and verification guidance. Owner: project_guidance.
- [x] Bundle verified anatomy geometry, hashes, licenses, and source records. Owner: anatomy_assets.
- [x] Build spacecraft, gates, space scenery and bounded vessel debris. Owner: space_visuals; interfaces in `src/systole/space-world.ts` and `spacecraft.ts`.
- [x] Integrate separate route, shared control document, spacecraft catalog and state; reimagine visible UI assets and copy. Owner: root.
- [x] Verify source loss/recovery, practice, steering, collision/restart, asset failure, original game isolation, keyboard, phone layout, and production subpath assets.
- [ ] Review diff; run unit/browser/build checks; commit and push only intended changes. Integrate into deployment branch without force push, verify Pages workflow and live route.

## Acceptance and next action

Both games appear separately on the home page. Existing control features remain reachable in Systole with spacecraft presentation. Real vessel meshes appear on impact, restart clears debris, stale signals remain fail-closed, and practice is explicitly labelled. Source and license credit ships with the game. Browser tests verify actual navigation and layout, unit tests cover collisions and existing signal contracts. Hardware behavior is inherited and must not be described as physically tested without a connected device.

Release commit `b8ad741` was pushed and merged through PR #1 as `d5b3e8e`. Both PR checks passed. Pages run `40550939640` then passed all Systole cases but stopped on the same four Other Side / Phone Breather UI timing failures observed on the prior main revision (70/74 cases passed). Follow-up `20898a7` removes the measured Other Side overlay blur cost, eliminates redundant idle SVG writes in Phone Breather, and retains CI failure traces. Neutral initialization also avoids settling before a signal arrives: zero radius writes in the first sampled 30 frames. Affected local browser checks and hosted build pass; assertions and timeouts are unchanged. Current next action: verify the full deployment gate for the latest main revision, then exercise the public routes and record the receipt. [Verification evidence](../docs/SYSTOLE-VERIFICATION.md) records the passing checks and release blocker. The active goal remains open until publication is verified.

Ruling: use the supplied detailed product brief and existing stack as execution authority; additional approval menus would repeat the already authorized build/publish request. Keep one checklist here, with task-specific engineering practices and independently owned asset/guidance work.
