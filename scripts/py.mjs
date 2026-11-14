#!/usr/bin/env node
// Cross-platform Python launcher for the npm scripts.
// Windows installs usually provide `python` or the `py` launcher instead of `python3`
// (and `python3` there can be a Microsoft Store stub that runs nothing), so we probe each
// candidate with a real version check and use the first that is Python 3.10+.
// Usage: node scripts/py.mjs <python arguments...>     Override: PYTHON=/path/to/python
import { spawnSync } from "node:child_process";

const MIN = [3, 10];
const candidates = [];
if (process.env.PYTHON) candidates.push([process.env.PYTHON]);
if (process.platform === "win32") candidates.push(["python"], ["py", "-3"], ["python3"]);
else candidates.push(["python3"], ["python"]);

function usable([cmd, ...pre]) {
  const probe = spawnSync(
    cmd,
    [...pre, "-c", "import sys; print('%d.%d' % sys.version_info[:2])"],
    { encoding: "utf8", windowsHide: true },
  );
  if (probe.error || probe.status !== 0) return false;
  const [major, minor] = probe.stdout.trim().split(".").map(Number);
  return major > MIN[0] || (major === MIN[0] && minor >= MIN[1]);
}

const found = candidates.find(usable);
if (!found) {
  console.error(
    `No Python ${MIN.join(".")}+ found (tried: ${candidates.map((c) => c.join(" ")).join(", ")}). ` +
      "Install Python or set the PYTHON environment variable to its path.",
  );
  process.exit(1);
}

const [cmd, ...pre] = found;
const run = spawnSync(cmd, [...pre, ...process.argv.slice(2)], { stdio: "inherit", windowsHide: true });
if (run.error) {
  console.error(`Failed to run ${cmd}: ${run.error.message}`);
  process.exit(1);
}
process.exit(run.status ?? 1);
