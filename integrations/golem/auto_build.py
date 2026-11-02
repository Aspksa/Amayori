"""Automatically build or refresh Amayori's Golem semantic cortex.
Called by the local Node server, not by a separate BAT.
"""
import importlib.util
import os
import shutil
import tempfile
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
SOURCE = DATA / "chats.json"
OUT = DATA / "golem"

def main():
    if not SOURCE.is_file():
        return
    messages = json.loads(SOURCE.read_text(encoding="utf-8"))
    if not isinstance(messages, list) or not any(isinstance(m, dict) and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str) and m["content"].strip() for m in messages):
        return
    cortex = OUT / "golem_cortex.json"
    metadata = OUT / "metadata.json"
    vectors = OUT / "golem_vectors.npy"
    if all(p.is_file() for p in (cortex, metadata, vectors)) and min(p.stat().st_mtime_ns for p in (cortex, metadata, vectors)) >= SOURCE.stat().st_mtime_ns:
        try:
            if json.loads(metadata.read_text(encoding="utf-8")).get("source") == "chats.json":
                return
        except (ValueError, OSError):
            pass
    needed = ("numpy", "sentence_transformers", "sklearn", "umap")
    if any(importlib.util.find_spec(name) is None for name in needed):
        print("Installing optional Golem dependencies...", flush=True)
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(ROOT / "integrations/golem/requirements.txt")], check=True, timeout=900)
    from build import build
    OUT.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="golem-stage-", dir=str(OUT.parent)))
    try:
        os.environ["AMAYORI_GOLEM_OUTPUT"] = str(stage)
        import build as builder
        builder.OUT = stage
        build()
        for filename in ("golem_cortex.json", "golem_vectors.npy", "metadata.json"):
            if not (stage / filename).is_file():
                raise RuntimeError("Incomplete brain build: " + filename)
        # Publish with rollback: metadata is the final commit marker.
        names = ("golem_vectors.npy", "golem_cortex.json", "metadata.json")
        backups = stage / "backup"
        backups.mkdir()
        published = []
        try:
            for filename in names:
                destination = OUT / filename
                if destination.exists():
                    shutil.copy2(destination, backups / filename)
                os.replace(stage / filename, destination)
                published.append(filename)
        except Exception:
            for filename in reversed(published):
                destination = OUT / filename
                backup = backups / filename
                if backup.exists():
                    os.replace(backup, destination)
                elif destination.exists():
                    destination.unlink()
            raise
    finally:
        shutil.rmtree(stage, ignore_errors=True)

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("Automatic Golem brain build failed:", exc, file=sys.stderr)
        sys.exit(1)
