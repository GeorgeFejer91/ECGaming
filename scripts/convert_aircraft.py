"""Convert a single redistributable aircraft source asset to an embedded GLB.

Usage:
  blender --background --python scripts/convert_aircraft.py -- SOURCE DESTINATION [TEXTURE]

The script intentionally preserves source geometry and materials. Runtime
orientation, centering, size normalisation, and propeller motion are handled by
ECGaming so every aircraft shares the same gameplay contract.
"""

from __future__ import annotations

import os
import pathlib
import sys

# Some Windows Blender distributions keep native Python dependencies in a
# conda-style Library/bin folder without adding it to the DLL search path.
_dll_directories = []
if hasattr(os, "add_dll_directory"):
    for candidate in (
        pathlib.Path(sys.prefix) / "Library" / "bin",
        pathlib.Path(sys.prefix) / "DLLs",
    ):
        if candidate.is_dir():
            _dll_directories.append(os.add_dll_directory(str(candidate)))

import bpy


def arguments() -> tuple[pathlib.Path, pathlib.Path, pathlib.Path | None]:
    try:
        marker = sys.argv.index("--")
        source, destination = sys.argv[marker + 1 : marker + 3]
    except (ValueError, IndexError) as error:
        raise SystemExit("Expected SOURCE and DESTINATION after --") from error
    texture = (
        pathlib.Path(sys.argv[marker + 3]).resolve()
        if len(sys.argv) > marker + 3
        else None
    )
    return pathlib.Path(source).resolve(), pathlib.Path(destination).resolve(), texture


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)


def load_source(source: pathlib.Path) -> None:
    suffix = source.suffix.lower()
    if suffix == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(source))
    elif suffix == ".fbx":
        clear_scene()
        bpy.ops.import_scene.fbx(filepath=str(source), use_anim=False)
    elif suffix == ".obj":
        clear_scene()
        # Blender 3.6 ships the newer OBJ importer under wm.obj_import.
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=str(source))
        else:
            bpy.ops.import_scene.obj(filepath=str(source))
    else:
        raise SystemExit(f"Unsupported aircraft source format: {suffix}")


def apply_texture(texture_path: pathlib.Path) -> None:
    image = bpy.data.images.load(str(texture_path), check_existing=True)
    material = bpy.data.materials.new(name="ECGaming source texture")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    shader.inputs["Roughness"].default_value = 0.65
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        obj.data.materials.clear()
        obj.data.materials.append(material)


def main() -> None:
    source, destination, texture = arguments()
    destination.parent.mkdir(parents=True, exist_ok=True)
    load_source(source)
    if texture:
        apply_texture(texture)

    mesh_names = [obj.name for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not mesh_names:
        raise SystemExit(f"No meshes found in {source}")

    # Remove cameras/lights authored for previews; the app supplies its own.
    for obj in list(bpy.context.scene.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)

    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        export_apply=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )
    print(f"ECGaming converted {source.name} -> {destination.name}")
    print("Meshes: " + ", ".join(mesh_names))


if __name__ == "__main__":
    main()
