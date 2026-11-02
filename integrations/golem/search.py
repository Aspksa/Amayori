"""Local semantic retrieval for the generated Golem memory cortex."""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / "data" / "golem"

def main():
    import numpy as np
    from sentence_transformers import SentenceTransformer
    query = sys.stdin.read(4096).strip()
    if not query:
        print(json.dumps({"indices": [], "scores": []}))
        return
    metadata = json.loads((FOLDER / "metadata.json").read_text(encoding="utf-8"))
    vectors = np.load(FOLDER / "golem_vectors.npy", allow_pickle=False)
    model = SentenceTransformer(metadata["model"], device="cpu")
    embedding = np.asarray(model.encode([query], normalize_embeddings=True)[0], dtype=np.float32)
    scores = vectors @ embedding
    top = np.argsort(scores)[-30:][::-1]
    print(json.dumps({"indices": top.tolist(), "scores": scores[top].tolist(), "mode": "semantic"}))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
