"""Bounded public SEC GET fetcher for evaluation custody.

Usage: python3 -I data/evaluation/fetch.py <role:test|withheld|development> <name> <url>
Test bytes go to sealed/raw, withheld acceptance bytes to withheld/raw (both git-ignored);
development bytes to development/raw.
Every attempt is appended to request-log.jsonl (URL, status, bytes, sha256; never amounts).
Hard limits: 80 attempts total (retries included), >=1.1 s apart, at most 2 retries per GET.
Exit 3 means blocked: stop all network work.
"""
import hashlib, json, pathlib, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
LOG = HERE / "request-log.jsonl"
UA = "domino-evaluation-custody (hackathon research)"  # truthful, no contact identity configured
CAP, GAP, RETRIES = 80, 1.1, 2


def attempts():
    return [json.loads(l) for l in LOG.read_text().splitlines()] if LOG.exists() else []


def main(role, name, url):
    dest = HERE / {"test": "sealed", "withheld": "withheld"}.get(role, "development") / "raw" / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    for retry in range(RETRIES + 1):
        log = attempts()
        if len(log) >= CAP:
            sys.exit("request cap reached")
        if log:
            wait = GAP - (time.time() - log[-1]["epoch"])
            if wait > 0:
                time.sleep(wait)
        status, body = None, b""
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                status, body = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, body = e.code, e.read()
        except OSError as e:
            status = f"error:{type(e).__name__}"
        entry = {"n": len(log) + 1, "epoch": time.time(), "at": datetime.now(timezone.utc).isoformat(),
                 "role": role, "url": url, "retry": retry, "status": status, "bytes": len(body),
                 "sha256": hashlib.sha256(body).hexdigest() if body else None}
        with LOG.open("a") as f:
            f.write(json.dumps(entry) + "\n")
        print(json.dumps({k: entry[k] for k in ("n", "url", "status", "bytes")}))
        if status == 200:
            dest.write_bytes(body)
            return
        if status in (403, 429) or status == 401:
            sys.exit(3)  # blocked: no workarounds
        if isinstance(status, int) and status < 500:
            sys.exit(f"http {status}")
    sys.exit("retries exhausted")


if __name__ == "__main__":
    main(*sys.argv[1:4])
