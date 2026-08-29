import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(projectRoot, "dist");
const outputRoot = resolve(distRoot, "games", "supertux", "runtime");
const cacheRoot = resolve(projectRoot, ".cache", "supertux");
const archivePath = join(cacheRoot, "SuperTux-v0.6.3-WASM.zip");
const releaseUrl =
  "https://github.com/SuperTux/supertux/releases/download/v0.6.3/SuperTux-v0.6.3-WASM.zip";
const expectedSha256 =
  "f9fa6eed36d403a283f3c544540b8a45b6c110375c1824e137ce1b4357e2d5df";

function assertInside(root, target) {
  const path = relative(root, target);
  if (!path || path.startsWith(".." + sep) || path === "..")
    throw new Error(`Unsafe build target: ${target}`);
}

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function download() {
  await mkdir(cacheRoot, { recursive: true });
  try {
    if ((await sha256(archivePath)) === expectedSha256) return;
  } catch {
    // Missing or invalid cache entries are replaced below.
  }
  const response = await fetch(releaseUrl, { redirect: "follow" });
  if (!response.ok || !response.body)
    throw new Error(`SuperTux download failed: HTTP ${response.status}`);
  const partial = archivePath + ".partial";
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const actual = await sha256(partial);
  if (actual !== expectedSha256) {
    await rm(partial, { force: true });
    throw new Error(`SuperTux archive hash mismatch: ${actual}`);
  }
  await rm(archivePath, { force: true });
  await import("node:fs/promises").then(({ rename }) => rename(partial, archivePath));
}

function run(command, args) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? accept() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function extract() {
  assertInside(distRoot, outputRoot);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  if (process.platform === "win32")
    await run("tar.exe", ["-xf", archivePath, "-C", outputRoot]);
  else await run("unzip", ["-q", archivePath, "-d", outputRoot]);
}

async function patchRuntime() {
  const htmlPath = join(outputRoot, "supertux2.html");
  await access(htmlPath);
  let html = await readFile(htmlPath, "utf8");
  html = html
    .replace(
      "if (!autofit || !Module)\r\n        return;",
      'if (!autofit || !Module || typeof Module.cwrap !== "function")\r\n        return;',
    )
    .replace(
      "if (!autofit || !Module)\n        return;",
      'if (!autofit || !Module || typeof Module.cwrap !== "function")\n        return;',
    )
    .replace(
      "</head>",
      '  <script src="coi-serviceworker.js"></script>\n</head>',
    )
    .replace(
      "</body>",
      '  <script type="module" src="../ecgaming-supertux-adapter.js"></script>\n</body>',
    );
  await writeFile(htmlPath, html, "utf8");
  await copyFile(
    resolve(projectRoot, "node_modules", "coi-serviceworker", "coi-serviceworker.js"),
    join(outputRoot, "coi-serviceworker.js"),
  );
  const launcherRoot = dirname(outputRoot);
  const launcherHtmlPath = join(launcherRoot, "index.html");
  let launcherHtml = await readFile(launcherHtmlPath, "utf8");
  launcherHtml = launcherHtml.replace(
    "</head>",
    '  <script src="./coi-serviceworker.js"></script>\n</head>',
  );
  await writeFile(launcherHtmlPath, launcherHtml, "utf8");
  await copyFile(
    resolve(projectRoot, "node_modules", "coi-serviceworker", "coi-serviceworker.js"),
    join(launcherRoot, "coi-serviceworker.js"),
  );
  await writeFile(
    join(outputRoot, "ECGAMING_SOURCE.txt"),
    [
      "SuperTux v0.6.3 official WebAssembly distribution",
      `Binary: ${releaseUrl}`,
      `SHA-256: ${expectedSha256}`,
      "Corresponding source: https://github.com/SuperTux/supertux/tree/v0.6.3",
      "ECGaming fork: https://github.com/GeorgeFejer91/supertux/tree/v0.6.3",
      "Licence: GPL-3.0; game data contains separately credited CC content.",
      "",
    ].join("\n"),
    "utf8",
  );
}

await download();
await extract();
await patchRuntime();
console.log(`Prepared SuperTux runtime at ${outputRoot}`);
