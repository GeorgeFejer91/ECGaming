"""Render one GLB from the ECGaming chase-camera direction for asset QA.

Usage:
  blender --background --python scripts/render_aircraft_preview.py -- MODEL OUTPUT.png
"""

from __future__ import annotations

import os
import pathlib
import sys

_dll_directories = []
if hasattr(os, "add_dll_directory"):
    for candidate in (
        pathlib.Path(sys.prefix) / "Library" / "bin",
        pathlib.Path(sys.prefix) / "DLLs",
    ):
        if candidate.is_dir():
            _dll_directories.append(os.add_dll_directory(str(candidate)))

import bpy
from mathutils import Vector


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    marker = sys.argv.index("--")
    model = pathlib.Path(sys.argv[marker + 1]).resolve()
    output = pathlib.Path(sys.argv[marker + 2]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(model))

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    minimum = Vector((min(point.x for point in corners), min(point.y for point in corners), min(point.z for point in corners)))
    maximum = Vector((max(point.x for point in corners), max(point.y for point in corners), max(point.z for point in corners)))
    center = (minimum + maximum) * 0.5
    extent = max(maximum.x - minimum.x, maximum.y - minimum.y, maximum.z - minimum.z)
    for root in [obj for obj in bpy.context.scene.objects if obj.parent is None]:
        root.location -= center

    bpy.ops.object.camera_add(location=(extent * 0.82, extent * 0.52, extent * 1.15))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = extent * 1.5
    look_at(camera, Vector((0, 0, 0)))
    bpy.context.scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=(-extent, extent * 1.5, extent))
    bpy.context.object.data.energy = 900
    bpy.context.object.data.shape = "DISK"
    bpy.context.object.data.size = extent * 2
    look_at(bpy.context.object, Vector((0, 0, 0)))
    bpy.ops.object.light_add(type="AREA", location=(extent, extent * 0.2, extent * 0.5))
    bpy.context.object.data.energy = 500
    bpy.context.object.data.size = extent
    look_at(bpy.context.object, Vector((0, 0, 0)))

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 400
    scene.render.resolution_y = 400
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = True
    scene.render.filepath = str(output)
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.world.color = (0.03, 0.04, 0.06)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
