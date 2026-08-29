import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(projectRoot, "dist");
const outputRoot = resolve(distRoot, "games", "moth");
const cacheRoot = resolve(projectRoot, ".cache", "moth");
const sourceRoot = resolve(cacheRoot, "source");
const forkUrl = "https://github.com/GeorgeFejer91/moth-game.git";
const upstreamUrl = "https://github.com/ahmedallam222/moth-game";
const pinnedCommit = "aa9506473a856a63f19e5650656c74793865b5d1";

function assertInside(root, target) {
  const path = relative(root, target);
  if (!path || path.startsWith(".." + sep) || path === "..")
    throw new Error(`Unsafe build target: ${target}`);
}

function run(command, args, cwd = projectRoot, capture = false) {
  return new Promise((accept, reject) => {
    let output = "";
    const child = spawn(command, args, {
      cwd,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    if (capture) child.stdout.on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? accept(output.trim())
        : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function prepareSource() {
  await mkdir(cacheRoot, { recursive: true });
  try {
    await run("git", ["rev-parse", "--git-dir"], sourceRoot, true);
  } catch {
    assertInside(cacheRoot, sourceRoot);
    await rm(sourceRoot, { recursive: true, force: true });
    await run("git", ["clone", "--no-checkout", forkUrl, sourceRoot]);
  }
  await run("git", ["fetch", "origin", pinnedCommit, "--depth", "1"], sourceRoot);
  await run("git", ["checkout", "--detach", "--force", pinnedCommit], sourceRoot);
  const actual = await run("git", ["rev-parse", "HEAD"], sourceRoot, true);
  if (actual !== pinnedCommit)
    throw new Error(`MOTH source pin mismatch: ${actual}`);
}

async function buildSource() {
  const npm = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const prefix = process.platform === "win32" ? ["/d", "/s", "/c", "npm"] : [];
  await run(npm, [...prefix, "ci", "--ignore-scripts"], sourceRoot);
  await run(npm, [...prefix, "rebuild", "esbuild"], sourceRoot);
  await run(npm, [...prefix, "run", "build"], sourceRoot);
}

async function stageBuild() {
  assertInside(distRoot, outputRoot);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await cp(join(sourceRoot, "dist"), outputRoot, { recursive: true });

  const htmlPath = join(outputRoot, "index.html");
  let html = await readFile(htmlPath, "utf8");
  html = html.replace(
    "</body>",
    `  <script type="module" src="./ecgaming-moth-adapter.js?v=${pinnedCommit.slice(0, 8)}"></script>\n</body>`,
  );
  await writeFile(htmlPath, html, "utf8");
  const workerPath = join(outputRoot, "sw.js");
  let worker = await readFile(workerPath, "utf8");
  worker = worker
    .replace("const CACHE = 'moth-v3';", `const CACHE = 'moth-ecgaming-${pinnedCommit.slice(0, 8)}';`)
    .replace(
      "'./icon-512.png'];",
      "'./icon-512.png', './ecgaming-moth-adapter.js'];",
    );
  await writeFile(workerPath, worker, "utf8");
  await cp(
    resolve(projectRoot, "public", "games", "moth", "ecgaming-moth-adapter.js"),
    join(outputRoot, "ecgaming-moth-adapter.js"),
  );
  await cp(join(sourceRoot, "LICENSE"), join(outputRoot, "LICENSE-MIT.txt"));
  await writeFile(
    join(outputRoot, "ECGAMING_SOURCE.txt"),
    [
      "MOTH — Drawn to the Light static browser build",
      `Source commit: ${pinnedCommit}`,
      `Original source: ${upstreamUrl}`,
      `ECGaming fork: ${forkUrl.replace(/\.git$/, "")}`,
      "Licence: MIT (copyright 2026 ahmedallam222).",
      "ECGaming adds a same-origin R-peak to standard Space-input adapter.",
      "",
    ].join("\n"),
    "utf8",
  );
}

await prepareSource();
await buildSource();
await stageBuild();
console.log(`Prepared MOTH browser build at ${outputRoot}`);
