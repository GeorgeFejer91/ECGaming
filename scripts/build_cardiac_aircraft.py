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
        color = (.67,.15,.20) if row % 2 == 0 else (.10,.35,.70)
        for i in range(40):
            x1, x2 = i/40, (i+1)/40
            y1 = base_y + .026*math.sin(x1*math.tau*2)
            y2 = base_y + .026*math.sin(x2*math.tau*2)
            line(x1,y1,x2,y2,.004,color)
            if i % 5 == 0:
                sign = -1 if i % 2 else 1
                line(x1,y1,x1+.055,y1+sign*.058,.0028,color)
                line(x1+.055,y1+sign*.058,x1+.13,y1+sign*.083,.0018,color)
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
    bsdf.inputs["Roughness"].default_value = .34 if metallic else .48
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
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=position)
    obj = finish(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def tube(name, points, radius, mat, taper=1):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 8
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    curve.use_fill_caps = True
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points)-1)
    for i, (point, co) in enumerate(zip(spline.bezier_points, points)):
        point.co = co
        point.radius = 1 + (taper - 1) * i / (len(points) - 1)
        point.handle_left_type = point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def wing(name, side, span, mat, *, root=.48, chord=1.65, sweep=.35,
         center_y=-.08, height=.02, rise=.22):
    """Closed loft with an elliptical section and a rounded, swept tip.

    The surface sampler also positions vessels on the actual membrane, so
    decorative tubes cannot float above a differently shaped wing.
    """
    def section(t):
        taper = math.sqrt(max(0, 1-t**6)) * (1-.32*t)
        return (side*(root+(span-root)*t), center_y-sweep*t**1.3,
                height+rise*t*t, taper)

    def surface(t, q, offset=0):
        x, y, z, taper = section(t)
        cosine = 1-2*q
        sine = math.sqrt(max(0, 1-cosine*cosine))
        return (x, y+chord*taper*.5*cosine,
                z+taper*((.075+.035*(cosine+1))*sine+.035*sine*sine)+offset)

    vertices, faces = [], []
    stations, around = 32, 24
    for i in range(stations):
        x, y, z, taper = section(i/stations)
        for j in range(around):
            theta = math.tau*j/around
            c, s = math.cos(theta), math.sin(theta)
            vertices.append((x, y+chord*taper*.5*c,
                             z+taper*((.075+.035*(c+1))*s+.035*s*s)))
    faces.append(tuple(reversed(range(around))))
    for i in range(stations-1):
        for j in range(around):
            a, b = i*around+j, i*around+(j+1)%around
            faces.append((a,b,b+around,a+around))
    tip = len(vertices)
    vertices.append(section(1)[:3])
    for j in range(around):
        faces.append(((stations-1)*around+j, (stations-1)*around+(j+1)%around, tip))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new()
    for face in mesh.polygons:
        for loop in face.loop_indices:
            co = mesh.vertices[mesh.loops[loop].vertex_index].co
            uv.data[loop].uv = ((co.x+3.6)/7.2, (co.y+1.9)/3.8)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    smooth_mesh(obj)
    return obj, surface


def smooth_mesh(obj):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)
    for face in obj.data.polygons:
        face.use_smooth = True


def attach(obj, parent):
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world
    return obj


def vessel_network(name, surface, mat, q, direction):
    """Editable curve splines joined by material to keep runtime draw calls low."""
    curves = [tube(name, [surface(t, q, .015) for t in (.02,.18,.36,.55,.74,.91)],
                   .044, mat, .28)]
    for t in (.23,.43,.63,.79):
        curves.append(tube(name+" branch", [surface(t, q, .014),
            surface(t+.045, q+direction*.09, .012),
            surface(t+.09, q+direction*.20, .009)], .024, mat, .2))
    bpy.ops.object.select_all(action="DESELECT")
    for obj in curves:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = curves[0]
    bpy.ops.object.join()
    return curves[0]


def heart(name, mat, slim):
    # Closed, rounded heart hull with its apex pointing toward the nose.
    vertices, faces = [], []
    segments, rings = 64, 24
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
    smooth_mesh(obj)
    subdiv = obj.modifiers.new("Continuous myocardium surface", "SUBSURF")
    subdiv.levels = subdiv.render_levels = 1
    return obj


def build(slug, slim, image):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    ruby = material("Myocardium", (.48,.018,.052) if not slim else (.62,.035,.052), .12)
    vessel = material("CardiacPulse Arteries", (.85,.045,.075), .15, emission=.3)
    vein = material("CardiacPulse Veins", (.018,.21,.82), .18, emission=.3)
    cream = material("Ivory capillary membrane", (.96,.83,.72), texture=image)
    trim = material("Cobalt wing edge", (.024,.12,.40), .32)
    dark = material("Atrial canopy", (.022,.095,.21), .32)
    pulse = material("CardiacPulse Septum", (1,.13,.16), emission=.3)
    core = heart("VentricleCore", ruby, slim)
    attach(ellipsoid("Atrial canopy", (0,.27,.71), (.30,.49,.22), dark), core)
    for side in (-1,1):
        span = 3.5 if slim else 3.2
        label = "Left" if side < 0 else "Right"
        # Only the assembly is named as a pulse part. The vessels inherit its
        # root-pivot flex instead of separating from the membrane on each beat.
        assembly = bpy.data.objects.new(label+" capillary wing", None)
        bpy.context.collection.objects.link(assembly)
        assembly.location = (side*.48, 0, .02)
        membrane, surface = wing(label+" membrane", side, span, cream,
                                 sweep=.62 if slim else .35)
        attach(membrane, assembly)
        attach(vessel_network(label+" arterial network", surface, vessel, .30, -1), assembly)
        attach(vessel_network(label+" venous network", surface, vein, .68, 1), assembly)
        attach(tube(label+" rounded leading edge", [surface(t,.035,-.015)
                    for t in (0,.16,.32,.48,.64,.78,.89,.96,.995)], .038, trim, .25), assembly)
        attach(ellipsoid(label+" pulse node", surface(.91,.46,.035), (.085,.075,.055), vein), assembly)
        tail, tail_surface = wing(label+" tail membrane", side, 1.28, ruby,
            root=.08, chord=.9, sweep=.37, center_y=-1.43, height=.04, rise=.12)
        tube(label+" tail vein", [tail_surface(t,.48,.016) for t in (0,.2,.4,.65,.88)], .033, vein, .3)
    attach(tube("Aortic arch", [(-.40,-.44,.58),(-.54,-.79,.88),(-.44,-1.16,1.12),
         (-.12,-1.37,1.12),(.19,-1.29,.94),(.32,-.98,.61)], .125, vessel, .85), core)
    attach(tube("Venous return", [(.51,-.40,.56),(.77,-.71,.80),(.80,-1.10,.93),
         (.65,-1.38,.75),(.47,-1.42,.42)], .105, vein, .8), core)

    # Project coronary vessels onto the smoothed hull; the same parent carries
    # both the heart surface and its vessels through RR contraction.
    bpy.context.view_layer.update()
    hull = core.evaluated_get(bpy.context.evaluated_depsgraph_get())
    def coronary(name, xy, radius, mat):
        points = []
        for x, y in xy:
            if slim:
                x /= 1.18
            hit, location, _, _ = hull.ray_cast(Vector((x,y,3)), Vector((0,0,-1)))
            if not hit:
                raise ValueError(f"{name}: vessel point misses the heart at {(x,y)}")
            points.append((x,y,location.z+radius*.5))
        attach(tube(name, points, radius, mat, .45), core)

    coronary("Coronary artery", [(-.42,-.55),(-.64,-.29),(-.57,.04),(-.40,.42),(-.15,.91)], .042, vessel)
    coronary("Arterial branch", [(-.57,.04),(-.78,.12),(-.74,.40),(-.55,.64)], .026, vessel)
    coronary("Coronary vein", [(.53,-.56),(.69,-.27),(.59,.08),(.41,.47),(.16,.91)], .047, vein)
    coronary("Venous branch", [(.59,.08),(.81,.20),(.73,.43),(.56,.64)], .028, vein)
    coronary("Septum seam", [(-.20,-.47),(-.23,-.27),(-.26,-.08),(-.27,.20)], .025, pulse)
    # Twin exhaust nozzles identify where the beat smoke originates.
    for side in (-1,1):
        tube("Vessel exhaust", [(side*.35,-.96,.0),(side*.38,-1.5,.02),(side*.38,-1.85,.11)], .12, trim)
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
    hub = ellipsoid("Valve hub", (0,1.98,.12), (.15,.13,.15), vein)
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
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / f"{slug}.blend"), compress=True)
    bpy.ops.render.render(write_still=True)


image = vessel_texture()
build("cardiac-ventricle", False, image)
build("cardiac-aorta", True, image)
