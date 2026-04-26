"""
kvstore — minimal Redis-backed key/value store with in-memory fallback.

WHY:
  Rate-limit counters and short-lived OTP / verification state used to live
  in module-level Python dicts. That breaks the moment you scale beyond a
  single uvicorn worker — each worker has its own memory, so a "5 attempts
  per IP" lock actually allows 5 × N attempts across N workers. It also
  loses all state on every backend restart.

HOW:
  This module exposes a tiny dict-like API (get / set / delete / incr /
  ttl / keys_matching). If REDIS_URL is set and the redis-py library is
  installed and reachable, it talks to Redis. Otherwise it falls back to a
  thread-safe in-memory dict — same behaviour as before, fine for dev and
  single-worker setups.

  Values are JSON-serialised. Use scalar types or plain dicts.

ENV:
  REDIS_URL=redis://localhost:6379/0   ← typical local Docker
  REDIS_URL=rediss://...               ← managed (Upstash, AWS, etc) — TLS
"""
from __future__ import annotations
import os, time, json, threading, fnmatch
from typing import Any, Iterable

REDIS_URL = os.getenv("REDIS_URL", "").strip()

_redis = None
_backend_name = "memory"

if REDIS_URL:
    try:
        import redis  # type: ignore
        _redis = redis.from_url(
            REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        _redis.ping()
        _backend_name = "redis"
        print(f"[kvstore] Connected to Redis: {REDIS_URL.split('@')[-1]}")
    except ImportError:
        print("[kvstore] redis-py not installed — falling back to in-memory store")
        _redis = None
    except Exception as e:
        print(f"[kvstore] Redis unreachable ({e}) — falling back to in-memory store")
        _redis = None

def backend() -> str:
    """Returns 'redis' or 'memory'. Useful for /health endpoints."""
    return _backend_name

# ─── In-memory fallback ─────────────────────────────────────────────────────
_mem: dict[str, Any] = {}
_mem_expires: dict[str, float] = {}
_mem_lock = threading.RLock()

def _mem_purge_expired():
    """Best-effort sweep — called on every read so memory doesn't bloat."""
    now = time.time()
    expired = [k for k, t in _mem_expires.items() if t <= now]
    for k in expired:
        _mem.pop(k, None)
        _mem_expires.pop(k, None)

# ─── Public API ─────────────────────────────────────────────────────────────

def get(key: str) -> Any | None:
    """Returns the deserialised JSON value, or None if missing/expired."""
    if _redis:
        v = _redis.get(key)
        if v is None: return None
        try:    return json.loads(v)
        except Exception: return None
    with _mem_lock:
        _mem_purge_expired()
        return _mem.get(key)

def set(key: str, value: Any, ttl: int | None = None) -> None:
    """Set a JSON value. ttl in seconds (None = no expiry)."""
    if _redis:
        payload = json.dumps(value)
        if ttl: _redis.setex(key, int(ttl), payload)
        else:   _redis.set(key, payload)
        return
    with _mem_lock:
        _mem[key] = value
        if ttl is not None:
            _mem_expires[key] = time.time() + int(ttl)
        else:
            _mem_expires.pop(key, None)

def delete(key: str) -> None:
    if _redis:
        _redis.delete(key)
        return
    with _mem_lock:
        _mem.pop(key, None)
        _mem_expires.pop(key, None)

def exists(key: str) -> bool:
    if _redis:
        return bool(_redis.exists(key))
    with _mem_lock:
        _mem_purge_expired()
        return key in _mem

def incr(key: str, ttl: int | None = None) -> int:
    """
    Atomically increment an integer counter and return the new value.
    If the key didn't exist, it's created with value=1 and TTL applied.
    If the key already had a TTL, it is NOT extended — the window stays
    fixed (so a sliding-window attack can't keep the key alive forever).
    """
    if _redis:
        # Pipeline: INCR + (EXPIRE NX) — only set TTL on first increment.
        # The NX flag (Redis 7+) is the cleanest way; for older versions we
        # check ttl<0 and conditionally EXPIRE.
        with _redis.pipeline() as p:
            p.incr(key)
            results = p.execute()
        new_val = int(results[0])
        if ttl is not None and new_val == 1:
            try:
                _redis.expire(key, int(ttl))
            except Exception:
                pass
        return new_val
    with _mem_lock:
        _mem_purge_expired()
        cur = int(_mem.get(key, 0)) + 1
        _mem[key] = cur
        if ttl is not None and key not in _mem_expires:
            _mem_expires[key] = time.time() + int(ttl)
        return cur

def ttl(key: str) -> int:
    """Returns seconds remaining until expiry. -1 if no TTL, -2 if missing."""
    if _redis:
        return int(_redis.ttl(key))
    with _mem_lock:
        if key not in _mem: return -2
        if key not in _mem_expires: return -1
        left = int(_mem_expires[key] - time.time())
        return max(left, 0)

def keys_matching(pattern: str) -> list[str]:
    """
    Glob-style key pattern (e.g. 'pw_reset:*'). Used for sweep-and-delete
    operations like 'invalidate all reset tokens for this email'. Avoid in
    hot paths — Redis SCAN is O(N) over keyspace.
    """
    if _redis:
        return list(_redis.scan_iter(match=pattern))
    with _mem_lock:
        _mem_purge_expired()
        return [k for k in list(_mem.keys()) if fnmatch.fnmatch(k, pattern)]
