from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable


SERVICE_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = SERVICE_ROOT.parent
DEFAULT_ENVIRONMENT_NAME = "impedance-studio-py311"
class LocalExecutionManager:
    """Run local fits with an explicitly selected Python interpreter."""

    def __init__(self, settings_path: Path | None = None, conda_command: str | None = None):
        self.settings_path = settings_path or Path(
            os.environ.get("IMPEDANCE_STUDIO_EXECUTION_SETTINGS") or Path.home() / ".impedance-studio" / "execution.json"
        )
        self.conda_command = conda_command if conda_command is not None else shutil.which("conda")

    def status(self) -> dict[str, Any]:
        selected = self._selected_executable()
        environments = [self._inspect_environment(candidate) for candidate in self._candidate_environments()]
        if selected and selected not in {item["executable"] for item in environments}:
            environments.append(self._inspect_environment(selected, label="Previously selected interpreter"))
        return {
            "mode": "local-python",
            "selected_executable": selected,
            "environments": environments,
            "can_create": bool(self.conda_command),
            "default_environment_name": DEFAULT_ENVIRONMENT_NAME,
            "requirements_path": str(PROJECT_ROOT / "requirements.txt"),
        }

    def ready(self) -> bool:
        executable = self._selected_executable()
        return bool(executable and self._inspect_environment(executable)["ready"])

    def select_environment(self, executable: str) -> dict[str, Any]:
        inspected = self._inspect_environment(executable)
        if not inspected["ready"]:
            raise ValueError(inspected["detail"])
        self._write_settings({"python_executable": inspected["executable"]})
        return self.status()

    def create_environment(self, name: str = DEFAULT_ENVIRONMENT_NAME) -> dict[str, Any]:
        if not self.conda_command:
            raise RuntimeError("Conda was not found. Install Conda, then create an environment with nleis==0.3.")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", name):
            raise ValueError("Environment names may only contain letters, numbers, '.', '_' and '-'.")

        requirements = PROJECT_ROOT / "requirements.txt"
        try:
            subprocess.run(
                [self.conda_command, "create", "--yes", "--name", name, "python=3.11"],
                check=True,
                capture_output=True,
                text=True,
                timeout=600,
            )
            subprocess.run(
                [self.conda_command, "run", "--no-capture-output", "--name", name, "python", "-m", "pip", "install", "-r", str(requirements)],
                check=True,
                capture_output=True,
                text=True,
                timeout=600,
            )
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or exc.stdout or "Conda could not create the environment.").strip()
            raise RuntimeError(detail) from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Creating the Conda environment exceeded ten minutes.") from exc

        executable = self._conda_environment_executable(name)
        self.select_environment(executable)
        return self.status()

    def fit(self, payload: dict[str, Any], direct_fit: Callable[..., dict[str, Any]]) -> dict[str, Any]:
        executable = self._selected_executable()
        if not executable:
            raise RuntimeError("Select a ready Python environment before running a local fit.")
        inspected = self._inspect_environment(executable)
        if not inspected["ready"]:
            raise RuntimeError(inspected["detail"])
        if _same_executable(executable, sys.executable):
            if "second_dataset" not in payload:
                return direct_fit(
                    payload["eis_dataset"],
                    payload["model"],
                )
            return direct_fit(
                payload["eis_dataset"],
                payload["second_dataset"],
                payload["model"],
                max_f=payload.get("max_f", 10),
            )

        environment = os.environ.copy()
        existing_pythonpath = environment.get("PYTHONPATH")
        environment["PYTHONPATH"] = str(SERVICE_ROOT) if not existing_pythonpath else f"{SERVICE_ROOT}{os.pathsep}{existing_pythonpath}"
        environment.setdefault("MPLCONFIGDIR", "/tmp/impedance-studio-matplotlib")
        try:
            completed = subprocess.run(
                [inspected["executable"], "-m", "impedance_studio.fit_worker"],
                input=json.dumps(payload, allow_nan=False),
                capture_output=True,
                text=True,
                env=environment,
                timeout=300,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Local fitting exceeded five minutes.") from exc
        try:
            response = json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            detail = completed.stderr.strip() or completed.stdout.strip() or "The selected interpreter returned no JSON result."
            raise RuntimeError(detail) from exc
        if completed.returncode or response.get("error"):
            raise RuntimeError(str(response.get("error") or completed.stderr.strip() or "The selected interpreter could not fit the data."))
        analysis = response.get("analysis")
        if not isinstance(analysis, dict):
            raise RuntimeError("The selected interpreter returned an invalid fit result.")
        return analysis

    def _candidate_environments(self) -> list[tuple[str, str]]:
        candidates = [(sys.executable, "Current service interpreter")]
        if self.conda_command:
            try:
                response = subprocess.run(
                    [self.conda_command, "env", "list", "--json"],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                prefixes = json.loads(response.stdout).get("envs", [])
            except (subprocess.SubprocessError, json.JSONDecodeError):
                prefixes = []
            for prefix in prefixes:
                path = Path(prefix)
                candidates.append((str(_python_at(path)), f"Conda: {path.name}"))

        unique: list[tuple[str, str]] = []
        seen: set[str] = set()
        for executable, label in candidates:
            resolved = str(Path(executable).expanduser())
            if resolved not in seen:
                seen.add(resolved)
                unique.append((resolved, label))
        return unique

    def _inspect_environment(self, candidate: str | tuple[str, str], label: str | None = None) -> dict[str, Any]:
        executable, candidate_label = candidate if isinstance(candidate, tuple) else (candidate, label or Path(candidate).stem)
        executable_path = Path(executable).expanduser()
        result = {
            "executable": str(executable_path),
            "label": candidate_label,
            "ready": False,
            "detail": "Interpreter was not found.",
            "python_version": None,
            "nleis_version": None,
        }
        if not executable_path.is_file():
            return result
        probe = """
import importlib.metadata, importlib.util, json, sys
result = {\"python_version\": sys.version.split()[0], \"missing\": [], \"nleis_version\": None}
for module in (\"numpy\", \"nleis\"):
    if importlib.util.find_spec(module) is None:
        result[\"missing\"].append(module)
if \"nleis\" not in result[\"missing\"]:
    try:
        result[\"nleis_version\"] = importlib.metadata.version(\"nleis\")
    except importlib.metadata.PackageNotFoundError:
        result[\"nleis_version\"] = \"available\"
print(json.dumps(result))
"""
        try:
            response = subprocess.run(
                [str(executable_path), "-c", probe],
                check=True,
                capture_output=True,
                text=True,
                timeout=20,
            )
            details = json.loads(response.stdout)
        except (subprocess.SubprocessError, json.JSONDecodeError):
            result["detail"] = "Could not inspect this interpreter."
            return result
        result["python_version"] = details.get("python_version")
        result["nleis_version"] = details.get("nleis_version")
        missing = details.get("missing", [])
        if missing:
            result["detail"] = f"Missing required packages: {', '.join(missing)}."
            return result
        result["ready"] = True
        result["detail"] = "Ready for real nleis.EISandNLEIS fitting."
        return result

    def _selected_executable(self) -> str | None:
        try:
            return str(json.loads(self.settings_path.read_text()).get("python_executable") or "") or None
        except (OSError, json.JSONDecodeError):
            return None

    def _write_settings(self, settings: dict[str, str]) -> None:
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings_path.write_text(json.dumps(settings, indent=2) + "\n")

    def _conda_environment_executable(self, name: str) -> str:
        response = subprocess.run(
            [self.conda_command or "conda", "run", "--no-capture-output", "--name", name, "python", "-c", "import sys; print(sys.executable)"],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return response.stdout.strip()


def _python_at(prefix: Path) -> Path:
    return prefix / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def _same_executable(left: str, right: str) -> bool:
    try:
        return Path(left).resolve() == Path(right).resolve()
    except OSError:
        return left == right
