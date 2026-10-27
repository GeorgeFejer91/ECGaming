"""Rebuild the source-preserving vessel GLB with Python's standard library.

Run from any directory: python path/to/anatomy-prepare-vessels.py
Only the two checked-in input files are read. No upstream code is executed.
Positions/normals retain their exact Float32 bytes; triangle indices are rebased
at the original BodyParts3D element boundaries recorded by OrganUI.
"""

import hashlib
import json
import math
from pathlib import Path
import struct


ROOT = Path(__file__).resolve().parent
SOURCE_HASH = "b80a727d022a4ab07ccfcf15caccc228eaccb6d69ec0e72923324946ac35a946"
SOURCE_COMMIT = "c72ce6654ff8e282942f97750d3104f55ef4fc3d"
VESSELS = {
    "ascending-aorta", "aortic-arch", "pulmonary-trunk",
    "superior-vena-cava", "left-coronary", "right-coronary",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def decode_glb(data):
    magic, version, length = struct.unpack_from("<III", data)
    require((magic, version, length) == (0x46546C67, 2, len(data)), "Invalid GLB header")
    json_length, json_type = struct.unpack_from("<II", data, 12)
    require(json_type == 0x4E4F534A, "Missing JSON chunk")
    document = json.loads(data[20:20 + json_length])
    binary_offset = 20 + json_length
    binary_length, binary_type = struct.unpack_from("<II", data, binary_offset)
    require(binary_type == 0x004E4942, "Missing binary chunk")
    binary = data[binary_offset + 8:binary_offset + 8 + binary_length]
    require(len(binary) == binary_length, "Truncated binary chunk")
    return document, binary


def accessor_bytes(document, binary, index):
    accessor = document["accessors"][index]
    require("sparse" not in accessor, "Sparse accessors are unsupported")
    require(accessor["componentType"] in (5125, 5126), "Expected 32-bit components")
    components = {"VEC3": 3, "SCALAR": 1}[accessor["type"]]
    width = components * 4
    view = document["bufferViews"][accessor["bufferView"]]
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", width)
    data = b"".join(binary[start + i * stride:start + i * stride + width]
                    for i in range(accessor["count"]))
    require(len(data) == accessor["count"] * width, "Truncated accessor")
    return data


def main():
    source = (ROOT / "anatomy-heart.glb").read_bytes()
    require(hashlib.sha256(source).hexdigest() == SOURCE_HASH, "Heart source hash changed")
    upstream = json.loads((ROOT / "anatomy-upstream-manifest.json").read_text(encoding="utf-8"))
    require(upstream["runtime"]["sha256"] == SOURCE_HASH, "Manifest refers to a different asset")
    original, original_binary = decode_glb(source)
    output = {
        "asset": {"version": "2.0", "generator": "ECGaming source-preserving vessel extraction",
                  "copyright": original["asset"]["copyright"]},
        "scene": 0, "scenes": [{"name": "BodyParts3D vessel elements", "nodes": []}],
        "nodes": [], "meshes": [], "materials": original["materials"],
        "accessors": [], "bufferViews": [], "buffers": [],
    }
    binary = bytearray()
    elements = []

    def add_accessor(data, count, kind, component, target, bounds=None):
        require(len(binary) % 4 == 0, "Invalid binary alignment")
        view_id = len(output["bufferViews"])
        output["bufferViews"].append({"buffer": 0, "byteOffset": len(binary),
                                      "byteLength": len(data), "target": target})
        binary.extend(data)
        accessor = {"bufferView": view_id, "componentType": component, "count": count, "type": kind}
        if bounds:
            accessor.update({"min": bounds[0], "max": bounds[1]})
        index = len(output["accessors"])
        output["accessors"].append(accessor)
        return index

    for group in upstream["structures"]:
        if group["id"] not in VESSELS:
            continue
        node = next(n for n in original["nodes"] if n["name"] == group["id"])
        require(not any(k in node for k in ("matrix", "translation", "rotation", "scale")),
                "Unexpected source node transform")
        primitive = original["meshes"][node["mesh"]]["primitives"][0]
        positions = accessor_bytes(original, original_binary, primitive["attributes"]["POSITION"])
        normals = accessor_bytes(original, original_binary, primitive["attributes"]["NORMAL"])
        indices = accessor_bytes(original, original_binary, primitive["indices"])
        vertex_offset = index_offset = 0
        reconstructed_positions, reconstructed_normals, reconstructed_indices = bytearray(), bytearray(), bytearray()
        for element in group["sources"]:
            count, triangles = element["vertices"], element["triangles"]
            pos = positions[vertex_offset * 12:(vertex_offset + count) * 12]
            norm = normals[vertex_offset * 12:(vertex_offset + count) * 12]
            original_indices = struct.unpack_from(f"<{triangles * 3}I", indices, index_offset * 4)
            local_indices = [index - vertex_offset for index in original_indices]
            require(all(0 <= index < count for index in local_indices), "Triangle crosses source-element boundary")
            values = list(struct.iter_unpack("<fff", pos))
            require(len(values) == count and all(math.isfinite(v) for point in values for v in point),
                    "Invalid source positions")
            require(all(math.isfinite(v) for normal in struct.iter_unpack("<fff", norm) for v in normal),
                    "Invalid source normals")
            lower = [min(point[axis] for point in values) for axis in range(3)]
            upper = [max(point[axis] for point in values) for axis in range(3)]
            name = f"{group['id']}__{element['element']}"
            mesh_id = len(output["meshes"])
            position_id = add_accessor(pos, count, "VEC3", 5126, 34962, (lower, upper))
            normal_id = add_accessor(norm, count, "VEC3", 5126, 34962)
            index_id = add_accessor(struct.pack(f"<{len(local_indices)}I", *local_indices),
                                    len(local_indices), "SCALAR", 5125, 34963)
            output["meshes"].append({"name": name, "primitives": [{
                "attributes": {"POSITION": position_id, "NORMAL": normal_id},
                "indices": index_id, "material": primitive["material"], "mode": 4,
            }]})
            extras = {"structureId": group["id"], "fma": group["fma"], "sourceElement": element["element"]}
            output["nodes"].append({"name": name, "mesh": mesh_id, "extras": extras})
            output["scenes"][0]["nodes"].append(mesh_id)
            elements.append({"node": name, **extras, "sourceObjSha256": element["sha256"],
                             "vertices": count, "triangles": triangles, "bounds": {"min": lower, "max": upper},
                             "center": [(a + b) / 2 for a, b in zip(lower, upper)]})
            reconstructed_positions.extend(pos)
            reconstructed_normals.extend(norm)
            reconstructed_indices.extend(struct.pack(f"<{len(local_indices)}I", *[i + vertex_offset for i in local_indices]))
            vertex_offset += count
            index_offset += triangles * 3
        require(bytes(reconstructed_positions) == positions and bytes(reconstructed_normals) == normals
                and bytes(reconstructed_indices) == indices, "Source geometry reconstruction differs")

    require(len(elements) == 58, "Expected 58 vessel source elements")
    output["buffers"] = [{"byteLength": len(binary)}]
    encoded = json.dumps(output, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    binary.extend(b"\0" * (-len(binary) % 4))
    result = (struct.pack("<III", 0x46546C67, 2, 28 + len(encoded) + len(binary))
              + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
              + struct.pack("<II", len(binary), 0x004E4942) + binary)
    decode_glb(result)
    (ROOT / "anatomy-vessels.glb").write_bytes(result)
    manifest = {
        "dataset": "BodyParts3D 4.0", "license": "CC-BY-4.0", "retrieved": "2026-10-27",
        "sourceRepository": "https://github.com/organui/heart-3d", "sourceCommit": SOURCE_COMMIT,
        "sourceFile": "public/models/heart.glb", "sourceSha256": SOURCE_HASH,
        "runtime": {"file": "anatomy-vessels.glb", "bytes": len(result),
                    "sha256": hashlib.sha256(result).hexdigest()},
        "changes": "Split six vessel groups at original source-element boundaries. Position and normal bytes unchanged; indices rebased. No new geometry, smoothing, decimation, or transforms.",
        "coordinates": "Same centered Y-up display coordinates as anatomy-heart.glb; +Z anterior; +X anatomical left. Each mesh still uses the full heart origin. Center geometry around the supplied center before independently rotating fragments.",
        "verification": "All 58 element triangle indices remain within their original vertex ranges. Reassembled positions, normals and indices exactly match all six original vessel groups.",
        "elements": elements,
    }
    (ROOT / "anatomy-vessels-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"elements": len(elements), "vertices": sum(e["vertices"] for e in elements),
                      "triangles": sum(e["triangles"] for e in elements), **manifest["runtime"]}, indent=2))


if __name__ == "__main__":
    main()
