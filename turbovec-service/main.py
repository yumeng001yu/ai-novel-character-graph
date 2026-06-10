"""
turbovec 向量检索微服务
替代 Neo4j Vector Index，提供更快的向量搜索和更低的内存占用
"""

import os
import json
import hashlib
import numpy as np
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from turbovec import IdMapIndex

app = FastAPI(title="TurboVec Vector Search Service")

# ─── 数据目录 ───
DATA_DIR = os.environ.get("TURBOVEC_DATA_DIR", "/app/data")
os.makedirs(DATA_DIR, exist_ok=True)

# ─── 索引管理 ───
# 每种实体类型（character / text_chunk）各维护一个 IdMapIndex
# key: index_name, value: IdMapIndex
indices: dict[str, IdMapIndex] = {}
# 元数据：uint64 id -> {entityId, novelId, type, ...}
# key: index_name, value: {uint64_id: metadata_dict}
metadata: dict[str, dict[int, dict]] = {}
# novelId -> Set[uint64_id] 映射，用于 allowlist 过滤
# key: index_name, value: {novelId: set(uint64_id)}
novel_index: dict[str, dict[str, set]] = {}
# entityId -> uint64_id 映射
# key: index_name, value: {entityId_str: uint64_id}
entity_id_map: dict[str, dict[str, int]] = {}
# 下一个可用的 uint64 ID
next_id_counter: dict[str, int] = {}

# 向量维度（从配置或首次 add 时确定）
dimensions: dict[str, int] = {}


def _get_index(name: str) -> IdMapIndex:
    """获取或创建索引"""
    if name not in indices:
        dim = dimensions.get(name, 1536)
        indices[name] = IdMapIndex(dim=dim, bit_width=4)
        metadata[name] = {}
        novel_index[name] = {}
        entity_id_map[name] = {}
        next_id_counter[name] = 1
    return indices[name]


def _entity_to_uint64(index_name: str, entity_id: str) -> int:
    """将字符串 entity ID 映射为 uint64（确定性）"""
    if index_name not in entity_id_map:
        entity_id_map[index_name] = {}

    if entity_id in entity_id_map[index_name]:
        return entity_id_map[index_name][entity_id]

    # 使用自增计数器
    if index_name not in next_id_counter:
        next_id_counter[index_name] = 1
    uid = next_id_counter[index_name]
    next_id_counter[index_name] += 1
    entity_id_map[index_name][entity_id] = uid
    return uid


# ─── API 模型 ───

class InitRequest(BaseModel):
    index_name: str
    dimensions: int = 1536

class AddRequest(BaseModel):
    index_name: str
    vectors: list[list[float]]
    entity_ids: list[str]
    novel_ids: list[str]
    extra_meta: Optional[list[dict]] = None

class SearchRequest(BaseModel):
    index_name: str
    query_vector: list[float]
    top_k: int = 10
    novel_id: Optional[str] = None  # 过滤指定小说

class DeleteRequest(BaseModel):
    index_name: str
    entity_id: str

class DeleteByNovelRequest(BaseModel):
    index_name: str
    novel_id: str

class SaveRequest(BaseModel):
    index_name: Optional[str] = None  # None = 保存全部

class LoadRequest(BaseModel):
    index_name: Optional[str] = None  # None = 加载全部


# ─── API 端点 ───

@app.get("/health")
async def health():
    return {"status": "ok", "indices": list(indices.keys())}


@app.post("/index/init")
async def init_index(req: InitRequest):
    """初始化索引（设置维度）"""
    dimensions[req.index_name] = req.dimensions
    _get_index(req.index_name)
    return {"status": "initialized", "index_name": req.index_name, "dimensions": req.dimensions}


@app.post("/index/add")
async def add_vectors(req: AddRequest):
    """添加向量到索引（已存在的ID会先移除再重新添加）"""
    if len(req.vectors) != len(req.entity_ids) or len(req.vectors) != len(req.novel_ids):
        raise HTTPException(400, "vectors, entity_ids, novel_ids 长度必须一致")

    idx = _get_index(req.index_name)

    # 确定维度
    if req.index_name not in dimensions and len(req.vectors) > 0:
        dimensions[req.index_name] = len(req.vectors[0])

    uint64_ids = []
    existing_uids_to_remove = []

    for i, (vec, eid, nid) in enumerate(zip(req.vectors, req.entity_ids, req.novel_ids)):
        # 检查是否已存在，已存在则标记移除
        eid_map = entity_id_map.get(req.index_name, {})
        if eid in eid_map:
            old_uid = eid_map[eid]
            existing_uids_to_remove.append(old_uid)

        uid = _entity_to_uint64(req.index_name, eid)
        uint64_ids.append(uid)

        # 存储元数据
        meta = {"entityId": eid, "novelId": nid}
        if req.extra_meta and i < len(req.extra_meta):
            meta.update(req.extra_meta[i])
        metadata[req.index_name][uid] = meta

        # 更新 novel 索引
        if req.index_name not in novel_index:
            novel_index[req.index_name] = {}
        if nid not in novel_index[req.index_name]:
            novel_index[req.index_name][nid] = set()
        novel_index[req.index_name][nid].add(uid)

    # 先移除已存在的向量（避免 add_with_ids panic）
    for old_uid in existing_uids_to_remove:
        try:
            idx.remove(old_uid)
        except Exception:
            pass

    # 批量添加向量
    vectors_np = np.array(req.vectors, dtype=np.float32)
    ids_np = np.array(uint64_ids, dtype=np.uint64)
    idx.add_with_ids(vectors_np, ids_np)

    return {"status": "added", "count": len(req.vectors)}


@app.post("/index/search")
async def search_vectors(req: SearchRequest):
    """搜索向量（支持按小说过滤）"""
    if req.index_name not in indices:
        return {"results": []}

    idx = indices[req.index_name]

    query = np.array([req.query_vector], dtype=np.float32)

    # 构建 allowlist
    if req.novel_id and req.index_name in novel_index:
        allowed_set = novel_index[req.index_name].get(req.novel_id, set())
        if not allowed_set:
            return {"results": []}
        allowed = np.array(list(allowed_set), dtype=np.uint64)
        scores, ids = idx.search(query, req.top_k, allowlist=allowed)
    else:
        scores, ids = idx.search(query, req.top_k)

    # 处理返回值：确保是 2D (num_queries × k)
    scores = np.atleast_2d(scores)
    ids = np.atleast_2d(ids)

    results = []
    for qi in range(scores.shape[0]):
        for si in range(scores.shape[1]):
            uid_int = int(ids[qi, si])
            score = float(scores[qi, si])
            if uid_int == 0:
                continue  # 未填充的槽位
            meta = metadata.get(req.index_name, {}).get(uid_int, {})
            results.append({
                "entityId": meta.get("entityId", str(uid_int)),
                "novelId": meta.get("novelId", ""),
                "score": score,
                "meta": {k: v for k, v in meta.items() if k not in ("entityId", "novelId")},
            })

    return {"results": results}


@app.post("/index/delete")
async def delete_vector(req: DeleteRequest):
    """删除单个向量"""
    if req.index_name not in indices:
        return {"status": "not_found"}

    uid = entity_id_map.get(req.index_name, {}).get(req.entity_id)
    if uid is None:
        return {"status": "not_found"}

    idx = indices[req.index_name]
    idx.remove(uid)

    # 清理元数据
    meta = metadata.get(req.index_name, {}).pop(uid, {})
    nid = meta.get("novelId", "")
    if nid and nid in novel_index.get(req.index_name, {}):
        novel_index[req.index_name][nid].discard(uid)

    entity_id_map.get(req.index_name, {}).pop(req.entity_id, None)

    return {"status": "deleted"}


@app.post("/index/delete-by-novel")
async def delete_by_novel(req: DeleteByNovelRequest):
    """删除指定小说的所有向量"""
    if req.index_name not in indices:
        return {"status": "not_found", "deleted": 0}

    uids = novel_index.get(req.index_name, {}).get(req.novel_id, set())
    count = 0
    for uid in list(uids):
        try:
            indices[req.index_name].remove(uid)
            count += 1
        except Exception:
            pass

    # 清理元数据
    for uid in list(uids):
        meta = metadata.get(req.index_name, {}).pop(uid, {})
        eid = meta.get("entityId", "")
        entity_id_map.get(req.index_name, {}).pop(eid, None)

    novel_index.get(req.index_name, {}).pop(req.novel_id, None)

    return {"status": "deleted", "count": count}


@app.post("/index/save")
async def save_index(req: SaveRequest):
    """持久化索引到磁盘"""
    names = [req.index_name] if req.index_name else list(indices.keys())
    saved = []
    for name in names:
        if name not in indices:
            continue
        dir_path = os.path.join(DATA_DIR, name)
        os.makedirs(dir_path, exist_ok=True)

        # 保存 turbovec 索引
        indices[name].write(os.path.join(dir_path, "index.tvim"))

        # 保存元数据
        meta_data = {
            "metadata": {str(k): v for k, v in metadata.get(name, {}).items()},
            "novel_index": {k: list(v) for k, v in novel_index.get(name, {}).items()},
            "entity_id_map": entity_id_map.get(name, {}),
            "next_id_counter": next_id_counter.get(name, 1),
            "dimensions": dimensions.get(name, 1536),
        }
        with open(os.path.join(dir_path, "meta.json"), "w") as f:
            json.dump(meta_data, f)

        saved.append(name)

    return {"status": "saved", "indices": saved}


@app.post("/index/load")
async def load_index(req: LoadRequest):
    """从磁盘加载索引"""
    names = [req.index_name] if req.index_name else [
        d for d in os.listdir(DATA_DIR)
        if os.path.isdir(os.path.join(DATA_DIR, d))
    ]
    loaded = []
    for name in names:
        dir_path = os.path.join(DATA_DIR, name)
        index_file = os.path.join(dir_path, "index.tvim")
        meta_file = os.path.join(dir_path, "meta.json")

        if not os.path.exists(index_file):
            continue

        try:
            # 加载 turbovec 索引
            indices[name] = IdMapIndex.load(index_file)

            # 加载元数据
            if os.path.exists(meta_file):
                with open(meta_file) as f:
                    meta_data = json.load(f)
                metadata[name] = {int(k): v for k, v in meta_data.get("metadata", {}).items()}
                novel_index[name] = {k: set(v) for k, v in meta_data.get("novel_index", {}).items()}
                entity_id_map[name] = meta_data.get("entity_id_map", {})
                next_id_counter[name] = meta_data.get("next_id_counter", 1)
                dimensions[name] = meta_data.get("dimensions", 1536)
            else:
                metadata[name] = {}
                novel_index[name] = {}
                entity_id_map[name] = {}
                next_id_counter[name] = 1

            loaded.append(name)
        except Exception as e:
            print(f"加载索引 {name} 失败: {e}")

    return {"status": "loaded", "indices": loaded}


@app.on_event("startup")
async def startup():
    """启动时自动加载已有索引"""
    try:
        await load_index(LoadRequest())
    except Exception as e:
        print(f"启动加载索引失败: {e}")


@app.on_event("shutdown")
async def shutdown():
    """关闭时自动保存索引"""
    try:
        await save_index(SaveRequest())
        print("索引已保存")
    except Exception as e:
        print(f"关闭保存索引失败: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8900)
