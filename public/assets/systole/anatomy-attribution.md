# Systole anatomy assets

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.

The heart and blood-vessel geometry is derived from **BodyParts3D 4.0** and distributed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The complete license is [included locally](licenses/CC-BY-4.0.txt). The [official archive license](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html), updated 2025-02-27, was checked on 2026-10-27. A dated [source-page snapshot](licenses/BodyParts3D-license-2026-10-27.html.txt) is included.

The bundled heart is the unchanged GLB prepared by [OrganUI](https://github.com/organui/heart-3d/tree/c72ce6654ff8e282942f97750d3104f55ef4fc3d), commit `c72ce6654ff8e282942f97750d3104f55ef4fc3d`. OrganUI selected and grouped source meshes, triangulated faces, centered and scaled the model, converted Z-up to Y-up, recomputed normals, assigned illustrative colors, and converted OBJ to GLB. Its [original attribution](licenses/OrganUI-ATTRIBUTION.md) and [source manifest](anatomy-upstream-manifest.json) are retained.

ECGaming additionally separated the four major vessel segments and both coronary trees into 58 original BodyParts3D element meshes. This extraction preserves position and normal bytes and all triangle topology. See [vessel mappings and checksums](anatomy-vessels-manifest.json) and the [reproduction script](anatomy-prepare-vessels.py).

Systole applies artistic materials, scaling, placement, motion, and fragmentation to these meshes. Its spacecraft, explosion, and ECG-driven motion are fictional game effects, not representations of tissue injury, circulation, or cardiac physiology. The source is a simplified adult male reference with truncated vessels and possible anatomical errors. It has not been independently clinically validated. DBCLS and OrganUI do not endorse this game.

Legacy OBJ comments mention CC BY-SA 2.1 Japan. These assets follow the current CC BY 4.0 grant for the official archive identified in OrganUI's pinned provenance; no Z-Anatomy or other independently adapted atlas data is included.

Original dataset publication: Mitsuhashi et al., *BodyParts3D: 3D structure database for anatomical concepts*, Nucleic Acids Research 37 (2009), D782–D785. [doi:10.1093/nar/gkn613](https://doi.org/10.1093/nar/gkn613).

The application's code license does not replace the anatomy asset license. Preserve this credit, source/license links, and modification notice when redistributing the model or derived images. No warranty is supplied; the full license retains its warranty disclaimer.
