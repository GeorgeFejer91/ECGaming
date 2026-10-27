# Verification and evidence

The active acceptance checklist lives in [PROJECT.md](PROJECT.md). These gates
define what evidence can support it; they do not claim the checks have run.
Use `VERIFIED`, `PARTIAL`, `BLOCKED`, or `NOT RUN`, with the command or observed
surface, result, and remaining limitation. Preserve failed outcomes until fixed.

## Scoped and integrated checks

| Change | Required evidence |
| --- | --- |
| Guidance only | Review the full diff, resolve local Markdown pointers, confirm exact skill names, and run `git diff --check`. No product rebuild is needed solely for prose. |
| Behavioral code | A focused meaningful test that can fail for the changed behavior; retain existing signal/readiness/privacy regression coverage when those boundaries change. |
| Browser game or shared browser code | `npm test` and `npm run build`, plus affected browser scenarios with `npm run test:browser -- <spec-path>`. Run the full browser suite when shared behavior or publication gates require it. |
| Hosted packaging | `npm run build:hosted`; check production output and entry paths. This stages the pinned MOTH build in addition to the Vite build. |
| Native app only | Use the relevant `native:typecheck`, `native:web:build`, and `native:test` scripts from `package.json`; browser-only changes do not require a native build. |

Commands run from the repository root using the locked dependency setup. Use
`npm ci` when installing dependencies; do not reinstall merely to change prose.
`npm run build` already runs TypeScript checking. Check actual exit codes and
relevant failures; a compact output summary alone is not proof of a pass.

## Systole and interface acceptance

For `/games/systole/`, verify the standalone entry, menu navigation, game start,
input, pause/recovery, and return flow in the rendered browser. Check that ECG
Plane remains separately accessible and that shared Polar/controller behavior
still follows the existing contracts. Inspect console errors and missing assets
in both development and hosted production paths. A build does not prove that a
Three.js scene renders or that a controller works.

For touched UI, verify desktop and phone layouts, 320 CSS px reflow, 200%
text/zoom, short viewports, and long labels. Use real Pretext measurement for
bounded text; prefer reflow or room before smaller type and provide a no-fit
outcome. Confirm readable full text, named controls, keyboard navigation,
visible focus, and usable touch controls. Include reduced-motion and
gesture-initiated audio behavior where the change introduces those surfaces.

Keep simulator/practice checks explicitly labelled. They cannot establish
physical Polar provenance, device freshness, physiological validity, or Quest
comfort. Raw samples remain within their existing ownership/privacy boundary.
Follow [hardware validation](../docs/HARDWARE-VALIDATION.md) for hardware claims;
mark unavailable hardware checks `NOT RUN` or `BLOCKED` instead of inferring a
pass from deterministic tests.

## Publication

Before the focused commit, review intended paths, licenses and notices, staged
diff, and relevant check results. After pushing, verify the remote branch SHA,
workflow run for that revision, and the deployed Systole and retained ECG Plane
routes. A successful push, build, and deployment are three separate claims.
Report a pending or failed workflow honestly and keep the overall acceptance
item open. [WORKFLOW.md](WORKFLOW.md) records the branch/deployment boundary.
