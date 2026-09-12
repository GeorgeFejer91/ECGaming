"""Author ECGaming's cardiac aircraft, packed Blender sources and runtime GLBs.

blender --background --python scripts/build_cardiac_aircraft.py
Coordinates: Blender +Y nose, +Z up; glTF -Z nose, +Y up.
All geometry and texture pixels are original procedural Blender work.
"""
from pathlib import Path
import math
import bpy
import os
import sys
_dll_directories = []
if hasattr(os, "add_dll_directory"):
    for candidate in (Path(sys.prefix) / "Library/bin", Path(sys.prefix) / "DLLs",
                      Path(bpy.app.binary_path).parent):
        if candidate.is_dir():
            _dll_directories.append(os.add_dll_directory(str(candidate)))
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/aircraft"
SOURCE = ROOT / "assets/blender"
TEXTURES = ROOT / "public/assets/flight"
for folder in (OUT, SOURCE, TEXTURES):
    folder.mkdir(parents=True, exist_ok=True)


def vessel_texture():
    size = 512
    yy, xx = np.mgrid[0:size, 0:size] / size
    grain = .014 * np.sin(xx * 190 + np.sin(yy * 140))
    pixels = np.ones((size, size, 4), dtype=np.float32)
    for channel, base in enumerate((.96, .83, .72)):
        pixels[:, :, channel] = base + grain

    def line(ax, ay, bx, by, width, color):
        dx, dy = bx - ax, by - ay
        t = np.clip(((xx-ax)*dx + (yy-ay)*dy) / max(1e-8, dx*dx+dy*dy), 0, 1)
        distance = np.sqrt((xx-ax-t*dx)**2 + (yy-ay-t*dy)**2)
        alpha = np.clip((width-distance)*size, 0, .78)
        for c in range(3):
            pixels[:, :, c] = pixels[:, :, c]*(1-alpha) + color[c]*alpha

    for row in range(4):
        base_y = row / 4 + .08
        for i in range(40):
            x1, x2 = i/40, (i+1)/40
            y1 = base_y + .026*math.sin(x1*math.tau*2)
            y2 = base_y + .026*math.sin(x2*math.tau*2)
            line(x1,y1,x2,y2,.004,(.67,.23,.27))
            if i % 5 == 0:
                sign = -1 if i % 2 else 1
                line(x1,y1,x1+.055,y1+sign*.058,.0028,(.77,.35,.34))
                line(x1+.055,y1+sign*.058,x1+.13,y1+sign*.083,.0018,(.77,.35,.34))
    image = bpy.data.images.new("Capillary tissue · original", width=size, height=size)
    image.pixels.foreach_set(pixels.ravel())
    image.filepath_raw = str(TEXTURES / "capillary-tissue.png")
    image.file_format = "PNG"
    image.save()
    image.pack()
    return image


def material(name, color, metallic=0, emission=0, texture=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = .38 if metallic else .55
    if emission:
        bsdf.inputs["Emission Color" if "Emission Color" in bsdf.inputs else "Emission"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = emission
    if texture:
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = texture
        mat.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def finish(obj, name, mat):
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def ellipsoid(name, position, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=position)
    obj = finish(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def tube(name, points, radius, mat):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 10
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points)-1)
    for point, co in zip(spline.bezier_points, points):
        point.co = co
        point.handle_left_type = point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def wing(name, points, mat):
    n = len(points)
    vertices = [(x,y,z) for x,y,z in points] + [(x,y,z-.13) for x,y,z in points]
    faces = [tuple(range(n)), tuple(reversed(range(n, 2*n)))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    if hasattr(mesh, "use_auto_smooth"):
        mesh.use_auto_smooth = True
    uv = mesh.uv_layers.new()
    for face in mesh.polygons:
        for loop in face.loop_indices:
            co = mesh.vertices[mesh.loops[loop].vertex_index].co
            uv.data[loop].uv = ((co.x+3.6)/7.2, (co.y+1.9)/3.8)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new("Soft leading edge", "BEVEL")
    bevel.width = .08
    bevel.segments = 3
    obj.modifiers.new("Wing normals", "WEIGHTED_NORMAL")
    return obj


def heart(name, mat, slim):
    # Closed, rounded heart hull with its apex pointing toward the nose.
    vertices, faces = [], []
    segments, rings = 64, 12
    for j in range(1, rings):
        phi = math.pi*j/rings
        for i in range(segments):
            t = math.tau*i/segments
            x = math.sin(t)**3 * (1.0 if slim else 1.18)
            y = -(13*math.cos(t)-5*math.cos(2*t)-2*math.cos(3*t)-math.cos(4*t))/14
            vertices.append((x*math.sin(phi), y*math.sin(phi)*1.42, math.cos(phi)*.64+.14))
    for j in range(rings-2):
        for i in range(segments):
            a = j*segments+i
            b = j*segments+(i+1)%segments
            faces.append((a,b,b+segments,a+segments))
    top, bottom = len(vertices), len(vertices)+1
    vertices += [(0,0,.78),(0,0,-.50)]
    for i in range(segments):
        faces.append((top,(i+1)%segments,i))
        a = (rings-2)*segments
        faces.append((bottom,a+i,a+(i+1)%segments))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    # Consistent normals on the custom manifold hull.
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)
    for face in mesh.polygons:
        face.use_smooth = True
    return obj


def build(slug, slim, image):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    ruby = material("Myocardium", (.52,.025,.072) if not slim else (.70,.075,.055), .16)
    vessel = material("Arterial enamel", (.88,.19,.20), .2)
    cream = material("Ivory capillary membrane", (.96,.83,.72), texture=image)
    gold = material("Warm brass", (.78,.45,.16), .65)
    dark = material("Atrial canopy", (.055,.045,.10), .48)
    pulse = material("CardiacPulse", (1,.22,.19), emission=.3)
    heart("VentricleCore", ruby, slim)
    ellipsoid("Left atrium", (-.44,-.62,.40), (.43,.48,.39), ruby)
    ellipsoid("Right atrium", (.44,-.62,.40), (.43,.48,.39), ruby)
    ellipsoid("Atrial canopy", (0,.08,.64), (.36,.58,.26), dark)
    for side in (-1,1):
        span = 3.5 if slim else 3.2
        points = [(side*.65,.55,.03), (side*span,-.15 if slim else .45,.22),
                  (side*(span-.15),-.72,.28), (side*1.7,-.94,.10), (side*.6,-.66,.02)]
        wing(("Left" if side<0 else "Right")+" capillary wing", points, cream)
        tube("Arterial leading edge", points[:3], .045, gold)
        tube("Wing conduction vessel", [(side*.8,0,.17),(side*1.55,-.22,.22),(side*2.5,-.38,.30)], .036, vessel)
        for branch in (1.4,1.9,2.4):
            tube("Purkinje branch", [(side*branch,-.3,.27),(side*(branch+.20),-.60,.29)], .018, vessel)
        ellipsoid("PulseNode", (side*(span-.16),-.35,.31), (.10,.14,.09), pulse)
        wing("Tail membrane", [(side*.15,-1.1,.1),(side*1.18,-1.65,.18),(side*.95,-2.05,.2),(side*.12,-1.87,.1)], ruby)
    tube("Aortic arch", [(-.28,-.66,.63),(-.42,-1.10,1.05),(0,-1.50,1.23),(.38,-1.40,.79)], .13, vessel)
    tube("Pulmonary return", [(.38,-.68,.58),(.64,-1.13,.94),(.66,-1.59,.73)], .09, gold)
    tube("Septum seam", [(0,.95,.48),(-.12,.6,.69),(-.17,.2,.77),(-.20,-.3,.77)], .035, pulse)
    # Twin exhaust nozzles identify where the beat smoke originates.
    for side in (-1,1):
        tube("Vessel exhaust", [(side*.35,-.96,.0),(side*.38,-1.5,.02),(side*.38,-1.85,.11)], .13, gold)
        ellipsoid("Exhaust aperture", (side*.38,-1.87,.11), (.105,.035,.105), dark)

    # A source-owned rotor is exported as a named pivot, facing forward.
    rotor = bpy.data.objects.new("CardiacRotor", None)
    bpy.context.collection.objects.link(rotor)
    rotor.location = (0,1.92,.12)
    for angle in (0,math.pi/2):
        blade = ellipsoid("Valve propeller", (0,1.92,.12), (.07,.055,.68), dark)
        blade.rotation_euler.y = angle
        blade.parent = rotor
        blade.matrix_parent_inverse = rotor.matrix_world.inverted()
    hub = ellipsoid("Valve hub", (0,1.98,.12), (.15,.13,.15), gold)
    hub.parent = rotor
    hub.matrix_parent_inverse = rotor.matrix_world.inverted()
    bpy.context.view_layer.update()
    # Export meshes + named empties only. Runtime owns beat timing, no looping clip.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=str(OUT / f"{slug}.glb"), export_format="GLB", use_selection=True, export_animations=False, export_apply=True)
    # Editable source includes a chase-camera product render and packed textures.
    bpy.ops.object.camera_add(location=(6,-9,7))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((0,0,.1))-camera.location).to_track_quat("-Z","Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 9.2
    scene = bpy.context.scene
    scene.camera = camera
    for location, energy, size in [((-4,2,8),1100,6),((5,-3,5),850,5)]:
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.data.energy, light.data.size = energy,size
        light.rotation_euler = (-light.location).to_track_quat("-Z","Y").to_euler()
    scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee") and hasattr(scene.eevee, "use_gtao"):
        scene.eevee.use_gtao = True
        scene.eevee.gtao_distance = 3
    if hasattr(scene.render, "use_file_extension"):
        scene.render.use_file_extension = True
    bpy.context.preferences.filepaths.save_version = 0
    scene.render.resolution_x, scene.render.resolution_y = 960,720
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(OUT / f"{slug}-preview.png")
    scene.view_settings.view_transform = "Standard"
    scene.world.color = (.20,.20,.20)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / f"{slug}.blend"))
    bpy.ops.render.render(write_still=True)


image = vessel_texture()
build("cardiac-ventricle", False, image)
build("cardiac-aorta", True, image)
