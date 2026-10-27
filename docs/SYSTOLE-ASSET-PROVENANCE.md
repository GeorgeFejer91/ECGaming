# Systole anatomical asset provenance

Verified on 2026-10-27. Research mode: GitHub/Docs, with official dataset-license corroboration and a counterevidence pass for outdated grants and anatomical limitations.

## Shipped files

| Runtime file | Bytes | SHA-256 | Content |
| --- | ---: | --- | --- |
| `public/assets/systole/anatomy-heart.glb` | 2,524,400 | `b80a727d022a4ab07ccfcf15caccc228eaccb6d69ec0e72923324946ac35a946` | Unchanged OrganUI heart, 11 groups, 63 underlying BodyParts3D elements, 56,404 vertices, 96,724 triangles |
| `public/assets/systole/anatomy-vessels.glb` | 875,800 | `82fdd41fec12f99c9fca9278740363fd0f834c67dd453ad74d158e86f4f68e8c` | 58 source-element meshes, 19,328 vertices, 30,314 triangles |

The source repository is [organui/heart-3d](https://github.com/organui/heart-3d), pinned to commit [`c72ce6654ff8e282942f97750d3104f55ef4fc3d`](https://github.com/organui/heart-3d/tree/c72ce6654ff8e282942f97750d3104f55ef4fc3d). The heart was downloaded from its exact [`public/models/heart.glb`](https://raw.githubusercontent.com/organui/heart-3d/c72ce6654ff8e282942f97750d3104f55ef4fc3d/public/models/heart.glb). Only selected asset and attribution files were obtained; no upstream application code was executed.

The [original manifest](../public/assets/systole/anatomy-upstream-manifest.json) retains the upstream archive, table, and per-OBJ checksums. The [local provenance manifest](../public/assets/systole/anatomy-provenance.json) records the downloaded and generated file hashes. The [visible attribution text](../public/assets/systole/anatomy-attribution.md), full CC BY 4.0 license, upstream notices, source mappings, and an official license-page snapshot are shipped alongside the assets.

## License evidence

The authoritative [BodyParts3D archive license](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html) specifies CC BY 4.0, last updated 2025-02-27. The [archive README](https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/README_e.html) independently records that license update. Its required credit is:

> BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.

Older OBJ comments retain CC BY-SA 2.1 Japan. The chosen asset's [pinned provenance](https://github.com/organui/heart-3d/blob/c72ce6654ff8e282942f97750d3104f55ef4fc3d/docs/MODEL_PROVENANCE.md) explicitly traces the geometry to the official archive, retrieved 2026-09-22 under the current grant. This distribution preserves that discrepancy and the modification chain. The [CC BY 4.0 legal code](https://creativecommons.org/licenses/by/4.0/legalcode.en) requires attribution, a license reference, and modification notices; it does not extend the application's code license to the anatomy model.

## Exact anatomy mappings

| Heart node / `userData.structureId` | Source concept | Source element(s) |
| --- | --- | --- |
| `right-atrium` | FMA9457 — wall of right atrium | FJ2439 |
| `left-atrium` | FMA9531 — wall of left atrium | FJ2438 |
| `ventricular-wall` | FMA13884 — wall of ventricle | FJ2428 |
| `right-ventricle` | FMA9291 — cavity of right ventricle | FJ2423 |
| `left-ventricle` | FMA9466 — cavity of left ventricle | FJ2422 |
| `ascending-aorta` | FMA3736 | FJ3413 |
| `aortic-arch` | FMA3768 | FJ3411 |
| `pulmonary-trunk` | FMA8612 | FJ2966 |
| `superior-vena-cava` | FMA4720 | FJ3645 |
| `left-coronary` | FMA50040 | 25 original elements, listed in the manifest |
| `right-coronary` | FMA50039 | 29 original elements, listed in the manifest |

Each vessel node is named `${structureId}__${sourceElement}`, for example `left-coronary__FJ2631`. Its glTF extras contain `structureId`, `fma`, and `sourceElement`; Three.js exposes them through `mesh.userData`. The [vessel manifest](../public/assets/systole/anatomy-vessels-manifest.json) lists every exact node name, source OBJ hash, vertex/triangle count, bounds, and center.

The wall remains a combined ventricular mesh. The two cavity meshes represent chamber spaces, not tissue. Atrial cavities, independently selectable valves, the inferior vena cava, pulmonary veins, most other vessels, and surrounding anatomy are absent.

## Coordinates and game integration

OrganUI transforms the original model using `(x, y, z) → (x, z, -y)` after subtracting source center `[21.5438, -113.22495, 1245.64]`, then uniformly scales by `0.02`. These are arbitrary display units. The exported scene is Y-up, +Z anterior, +X anatomical left, centered around zero. An anterior camera looks toward the origin from +Z.

Measured heart bounds are `[-1.1569499969, -1.4290000200, -1.2676010132]` to `[1.1569499969, 1.4290000200, 1.2676010132]`; size is approximately `2.313900 × 2.858000 × 2.535202`.

All vessel geometries retain the same heart-wide origin. Before rotating an individual debris piece, clone its geometry, compute its bounding-box center, and translate the clone by the negative center. Apply the desired game scale afterward. This is a runtime artistic transformation and does not alter the checked-in asset.

The 58 vessel pieces follow original mesh boundaries, not simulated biological fractures. Lighting, materials, spacecraft motion, repeated/scaled debris, and explosion trajectories are game art. No anatomical correctness is claimed for the explosion, nor clinical or physiological validation for the model. The [official release notes](https://dbarchive.biosciencedbc.jp/data/bodyparts3d/20130619/release_4.0_e.html) warn of potential anatomical and mapping errors; the [database description](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html) identifies an adult male reference model.

## Reproduce and verify

Run `python public/assets/systole/anatomy-prepare-vessels.py` from the repository root. It uses only Python's standard library and the two checked-in input files; it does not download or execute third-party code. It rejects a changed heart checksum, splits the six vessel groups using source element counts, retains Float32 position/normal bytes, rebases only triangle indices, and writes the vessel GLB and manifest.

Completed verification:

- The downloaded heart matches the pinned upstream SHA-256 and byte length.
- Fresh official `partof_element_parts.txt` and `isa_element_parts.txt` downloads match the upstream manifest hashes; all 63 source element mappings match in order.
- All 58 vessel elements have finite positions/normals and in-range indices. Reassembling their positions, normals, and indices reproduces the original six vessel groups byte-for-byte.
- Both GLBs load through the project's installed Three.js `GLTFLoader`. All 11/58 expected meshes, their source metadata, actual geometry counts, and finite coordinates were verified independently of the extraction writer.

Current official mapping-table hashes: PART-OF `3f5f6df1028eb122b30de77c711597b6bb8e5541658e5985859fd228adbf88ea`; IS-A `a3de74423f943b0d724ae8f59b3a817f87c423a544f8db98113b1980817cbeaf`.

This work verifies source identifiers and geometry transport. It does not independently reproduce OrganUI's original 136 MiB archive conversion or certify anatomical accuracy. The parent game task owns final rendering, gameplay checks, publication, and deployment verification.

## Candidate and counterevidence review

| Candidate | Evidence and decision |
| --- | --- |
| [OrganUI heart](https://github.com/organui/heart-3d) | Selected: compact GLB, explicit source mappings/checksums, separated coronary trees, official archive license trace. Expert anatomy review is pending. |
| [BodyParts3D full mesh API](https://github.com/olivercase/body_parts_3d_api) | Not shipped: broad full-resolution OBJ/LFS collection would require another conversion and has a different documented source/license chain. |
| [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy) | Not shipped: large Blender atlas, additional adaptations and per-source notices including mixed terms; unnecessary for the scoped heart/vessel subset. |

The narrowed check confirmed the selected source against the official license, current official mapping tables, actual GLB metadata, and source limitations. Repository popularity was not used as evidence of anatomical validity.
