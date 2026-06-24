import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";

const probe = "import nleis, numpy; print('ready')";
const configured = process.env.IMPEDANCE_STUDIO_PYTHON || selectedInterpreter();
const interpreter = configured || discoverCondaInterpreter();

if (!interpreter) {
  console.error("No Python interpreter with nleis==0.3 was found.");
  console.error("Select one in Local Python mode, set IMPEDANCE_STUDIO_PYTHON, or create impedance-studio-py311 from the workbench.");
  process.exit(1);
}

console.log(`Running real nleis fitting tests with ${interpreter}`);
const result = spawnSync(interpreter, ["-m", "unittest", "discover", "-s", "service/tests"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PYTHONPATH: ["service", process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    MPLCONFIGDIR: process.env.MPLCONFIGDIR || "/tmp/impedance-studio-matplotlib",
  },
  encoding: "utf8",
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.status ?? 1;

function selectedInterpreter() {
  const settingsPath = join(process.env.HOME || "", ".impedance-studio", "execution.json");
  try {
    const executable = JSON.parse(readFileSync(settingsPath, "utf8")).python_executable;
    return typeof executable === "string" && isReady(executable) ? executable : null;
  } catch {
    return null;
  }
}

function discoverCondaInterpreter() {
  const conda = spawnSync("conda", ["env", "list", "--json"], { encoding: "utf8" });
  if (conda.status !== 0) return null;
  try {
    for (const prefix of JSON.parse(conda.stdout).envs || []) {
      const executable = process.platform === "win32" ? join(prefix, "Scripts", "python.exe") : join(prefix, "bin", "python");
      if (existsSync(executable) && isReady(executable)) return executable;
    }
  } catch {
    return null;
  }
  return null;
}

function isReady(executable) {
  return spawnSync(executable, ["-c", probe], { encoding: "utf8", timeout: 20000 }).status === 0;
}
