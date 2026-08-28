// Print lightweight node/mesh metadata from one or more GLB files.
import fs from "node:fs";
import { Box3, Matrix4, Quaternion, Vector3 } from "three";

const nodeMatrix = (node) => {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(
    new Vector3().fromArray(node.translation ?? [0, 0, 0]),
    new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
    new Vector3().fromArray(node.scale ?? [1, 1, 1]),
  );
};

const documentBounds = (document) => {
  const result = new Box3();
  const visit = (nodeIndex, parentMatrix) => {
    const node = document.nodes[nodeIndex];
    const world = parentMatrix.clone().multiply(nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of document.meshes[node.mesh].primitives) {
        const accessor = document.accessors[primitive.attributes.POSITION];
        if (!accessor.min || !accessor.max) continue;
        const local = new Box3(
          new Vector3().fromArray(accessor.min),
          new Vector3().fromArray(accessor.max),
        );
        for (const x of [local.min.x, local.max.x])
          for (const y of [local.min.y, local.max.y])
            for (const z of [local.min.z, local.max.z])
              result.expandByPoint(new Vector3(x, y, z).applyMatrix4(world));
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of document.scenes[document.scene ?? 0].nodes ?? []) {
    visit(root, new Matrix4());
  }
  return result;
};

for (const filename of process.argv.slice(2)) {
  const bytes = fs.readFileSync(filename);
  if (bytes.toString("ascii", 0, 4) !== "glTF") {
    throw new Error(`${filename} is not a binary glTF file`);
  }
  const jsonLength = bytes.readUInt32LE(12);
  const jsonType = bytes.toString("ascii", 16, 20);
  if (jsonType !== "JSON") throw new Error(`${filename} has no JSON chunk`);
  const document = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  console.log(`\n${filename}`);
  const size = documentBounds(document).getSize(new Vector3());
  console.log(`bounds=${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)}`);
  for (const [index, node] of (document.nodes ?? []).entries()) {
    const mesh = node.mesh === undefined ? "" : ` mesh=${document.meshes?.[node.mesh]?.name ?? node.mesh}`;
    const transform = node.translation ? ` at=${node.translation.join(",")}` : "";
    console.log(`${index}: ${node.name ?? "(unnamed)"}${mesh}${transform}`);
  }
}
