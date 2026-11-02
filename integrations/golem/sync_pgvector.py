"""Refresh the optional pgvector search index from the single canonical chat archive.

The JSON archive remains the source of truth. This index can always be rebuilt.
Run after the Golem embedding builder; never run during a chat request.
"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
def sync():
    url = os.environ.get("AMAYORI_DATABASE_URL")
    if not url:
        return
    import numpy as np
    import psycopg
    messages = json.loads((DATA / "chats.json").read_text(encoding="utf-8"))
    cortex = json.loads((DATA / "golem" / "golem_cortex.json").read_text(encoding="utf-8"))
    vectors = np.load(DATA / "golem" / "golem_vectors.npy", allow_pickle=False)
    if len(cortex) != len(vectors) or vectors.ndim != 2 or vectors.shape[1] != 384:
        raise ValueError("Incompatible Golem vectors")
    with psycopg.connect(url, connect_timeout=5) as conn:
        with conn.transaction():
            conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            conn.execute("""CREATE TABLE IF NOT EXISTS amayori_vector_index(
                source_id TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                embedding vector(384) NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
            ids = []
            for node, vector in zip(cortex, vectors):
                source_id = node["id"]
                if not source_id.startswith("chat-"):
                    raise ValueError("Unexpected node ID")
                index = int(source_id[5:])
                message = messages[index]
                if message.get("role") not in ("user", "assistant") or not isinstance(message.get("content"), str):
                    raise ValueError("Canonical message mismatch")
                ids.append(source_id)
                conn.execute("""INSERT INTO amayori_vector_index(source_id,role,content,embedding)
                    VALUES (%s,%s,%s,%s::vector)
                    ON CONFLICT(source_id) DO UPDATE SET role=EXCLUDED.role,content=EXCLUDED.content,
                    embedding=EXCLUDED.embedding,updated_at=now()""",
                    (source_id, message["role"], message["content"], "[" + ",".join(map(str,vector.tolist())) + "]"))
            conn.execute("DELETE FROM amayori_vector_index WHERE NOT (source_id = ANY(%s))", (ids,))
    print("pgvector search index updated:", len(ids))

if __name__ == "__main__":
    sync()
