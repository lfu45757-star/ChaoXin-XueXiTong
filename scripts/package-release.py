"""Build the local release without credentials or course-specific evidence."""
from hashlib import sha256
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
archive = root.parent / f"chaoxing-agent-{version}.zip"
root_names = (
    ".env.example", ".gitignore", "answer.schema.json", "package.json",
    "README.md", "DEPLOYMENT.md", "server.mjs", "start.cmd", "start.ps1",
)
files = [root / name for name in root_names]
for folder in ("extension", "lib", "scripts", "test"):
    for path in sorted((root / folder).rglob("*")):
        if not path.is_file() or "__pycache__" in path.parts:
            continue
        if path.suffix == ".png" or path.name.startswith("live-") or path.name == "font-results.json":
            continue
        files.append(path)

contents = {path.relative_to(root).as_posix(): path.read_bytes() for path in files}
token_path = root / "data" / "token.txt"
token = token_path.read_bytes().strip() if token_path.exists() else b""
for name, value in contents.items():
    assert not (token and token in value), f"Pair token found in {name}"
manifest = {
    "version": version,
    "files": {name: {"sha256": sha256(value).hexdigest(), "bytes": len(value)}
              for name, value in sorted(contents.items())},
    "excluded": ["data/", ".env", "node_modules/", "live-*", "*.png", "font-results.json"],
}
manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
(root / "release-files.json").write_bytes(manifest_bytes)
contents["release-files.json"] = manifest_bytes
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
    for name, value in sorted(contents.items()):
        output.writestr(f"{root.name}/{name}", value)
with zipfile.ZipFile(archive) as output:
    assert output.testzip() is None
    for name, details in manifest["files"].items():
        assert sha256(output.read(f"{root.name}/{name}")).hexdigest() == details["sha256"]
print(json.dumps({"archive": str(archive), "files": len(contents),
                  "bytes": archive.stat().st_size,
                  "sha256": sha256(archive.read_bytes()).hexdigest()}, ensure_ascii=False))
