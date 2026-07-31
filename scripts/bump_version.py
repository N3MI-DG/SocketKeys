#!/usr/bin/env python3
"""
Bumps SocketKeys' version across every file that carries one.

"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_JSON = ROOT / "package.json"
PACKAGE_LOCK_JSON = ROOT / "package-lock.json"
TAURI_CONF_JSON = ROOT / "src-tauri" / "tauri.conf.json"
CARGO_TOML = ROOT / "src-tauri" / "Cargo.toml"

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
CARGO_VERSION_RE = re.compile(r'(?m)^version\s*=\s*"([^"]+)"')


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def cargo_version() -> str:
    match = CARGO_VERSION_RE.search(CARGO_TOML.read_text(encoding="utf-8"))
    if not match:
        sys.exit(f"Could not find a version in {CARGO_TOML}")
    return match.group(1)


def set_cargo_version(new_version: str) -> None:
    text = CARGO_TOML.read_text(encoding="utf-8")
    updated, count = CARGO_VERSION_RE.subn(f'version = "{new_version}"', text, count=1)
    if count != 1:
        sys.exit(f"Could not update version in {CARGO_TOML}")
    CARGO_TOML.write_text(updated, encoding="utf-8")


def set_package_json_version(new_version: str) -> None:
    data = read_json(PACKAGE_JSON)
    data["version"] = new_version
    write_json(PACKAGE_JSON, data)


def set_package_lock_version(new_version: str) -> None:
    data = read_json(PACKAGE_LOCK_JSON)
    data["version"] = new_version
    root_package = data.get("packages", {}).get("")
    if root_package is not None:
        root_package["version"] = new_version
    write_json(PACKAGE_LOCK_JSON, data)


def set_tauri_conf_version(new_version: str) -> None:
    data = read_json(TAURI_CONF_JSON)
    data["version"] = new_version
    write_json(TAURI_CONF_JSON, data)


def main() -> None:
    versions = {
        "package.json": read_json(PACKAGE_JSON)["version"],
        "package-lock.json": read_json(PACKAGE_LOCK_JSON)["version"],
        "src-tauri/tauri.conf.json": read_json(TAURI_CONF_JSON)["version"],
        "src-tauri/Cargo.toml": cargo_version(),
    }

    print("Current version(s):")
    for label, version in versions.items():
        print(f"  {label}: {version}")
    if len(set(versions.values())) > 1:
        print("  (these have drifted out of sync with each other)")

    default = versions["src-tauri/tauri.conf.json"]
    new_version = input(f"\nNext version [{default}]: ").strip() or default

    if not VERSION_RE.match(new_version):
        sys.exit(f"'{new_version}' doesn't look like a version (expected e.g. 1.2.3 or 1.2.3-beta.1)")

    set_package_json_version(new_version)
    set_package_lock_version(new_version)
    set_tauri_conf_version(new_version)
    set_cargo_version(new_version)

    print(
        f"\nUpdated package.json, package-lock.json, src-tauri/tauri.conf.json, "
        f"and src-tauri/Cargo.toml to {new_version}."
    )

    tag = f"v{new_version}"
    print(
        f"""
Next steps to actually cut this release (.github/workflows/release.yml
only triggers on a pushed "v*" tag):

  1. git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
  2. git commit -m "Bump version to {new_version}"
  3. git tag {tag}
  4. git push origin main
  5. git push origin {tag}
  6. Wait for the "Release" workflow to finish in the Actions tab.
  7. Open that draft on the Releases page and click "Publish release".
"""
    )


if __name__ == "__main__":
    main()
