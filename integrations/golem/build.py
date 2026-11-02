"""Generate Golem-compatible semantic cortex from Amayori's local memory graph.
Optional: pip install -r integrations/golem/requirements.txt
Run: py -3 integrations/golem/build.py
"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = DATA / "golem"
MODEL = os.environ.get("AMAYORI_GOLEM_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")

def build():
    import numpy as np
    from sentence_transformers import SentenceTransformer
    from sklearn.decomposition import PCA
    source = DATA / "chats.json"
    messages = json.loads(source.read_text(encoding="utf-8")) if source.exists() else []
    nodes = []
    for i, message in enumerate(messages):
        if not isinstance(message, dict) or message.get("role") not in ("user", "assistant"):
            continue
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            nodes.append({"id": "chat-" + str(i), "label": content.strip()[:3000], "role": message["role"]})
    nodes = nodes[-1500:]
    if not nodes:
        raise SystemExit("Нет сообщений в архиве Amayori. Сначала создайте переписку.")
    model = SentenceTransformer(MODEL, device="cpu")
    texts = [str(n.get("label") or n.get("id") or "") for n in nodes]
    vectors = np.asarray(model.encode(texts, normalize_embeddings=True, show_progress_bar=True), dtype=np.float32)
    if len(nodes) >= 4:
        try:
            import umap
            coords = umap.UMAP(n_components=3, n_neighbors=min(15, len(nodes)-1), random_state=42).fit_transform(vectors)
        except Exception as exc:
            print("UMAP недоступен, используется PCA:", exc)
            coords = PCA(n_components=3).fit_transform(vectors)
    elif len(nodes) >= 3:
        coords = PCA(n_components=3).fit_transform(vectors)
    else:
        coords = np.zeros((len(nodes), 3), dtype=np.float32)
        for i in range(len(nodes)):
            coords[i, 0] = i
    coords = np.asarray(coords, dtype=np.float32)
    span = np.max(np.abs(coords), axis=0)
    coords = coords / np.where(span < 1e-8, 1, span) * 10
    palette = {"user": [.22, .74, .97], "assistant": [.69, .22, .30]}
    cortex = [{"id": n["id"], "title": texts[i][:500], "cat": "Пользователь" if n["role"] == "user" else "ИИ", "col": palette[n["role"]], "pos": coords[i].tolist(), "count": 1} for i,n in enumerate(nodes)]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "golem_cortex.json").write_text(json.dumps(cortex, ensure_ascii=False), encoding="utf-8")
    np.save(OUT / "golem_vectors.npy", vectors)
    (OUT / "metadata.json").write_text(json.dumps({"model": MODEL, "nodes": len(nodes), "source": "chats.json", "projection": "UMAP-or-PCA"}, ensure_ascii=False), encoding="utf-8")
    print("Готово:", len(nodes), "узлов, каталог:", OUT)

if __name__ == "__main__":
    build()
