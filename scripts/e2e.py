"""Step-by-step end-to-end run on Studionet (each step is idempotent-ish and logged).

  python scripts/e2e.py create            # requester snapshots a GenLayer docs page, escrows 1 GEN
  python scripts/e2e.py submit <actor> <file>
  python scripts/e2e.py judge|appeal|finalize <actor> [job_id]
  python scripts/e2e.py wait <tx>
  python scripts/e2e.py show [job_id]

Every tx hash is appended to e2e_log.json.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from glc import ROOT, actors, address, client, read, wait  # noqa: E402

LOG = ROOT / "e2e_log.json"
URL = "https://docs.genlayer.com/understand-genlayer-protocol/what-is-genlayer"
ANCHOR = "GenLayer is a blockchain for applications"
GLOSSARY = {"Intelligent Contract": "智能合约（Intelligent Contract）", "validators": "验证者"}


def log(step, tx, extra=None):
    data = json.loads(LOG.read_text()) if LOG.exists() else []
    data.append({"step": step, "tx": tx, **(extra or {})})
    LOG.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def send(actor, fn, args, value=0):
    acct = actors()[actor]
    tx = client(acct).write_contract(address=address(), function_name=fn, args=args, value=value)
    tx = tx.hex() if hasattr(tx, "hex") else str(tx)
    if not tx.startswith("0x"):
        tx = "0x" + tx
    print(fn, "tx", tx)
    log(fn, tx, {"actor": actor, "from": acct.address})
    return tx


cmd = sys.argv[1]
if cmd == "create":
    send("requester", "create_job_from_url", [
        "GenLayer docs: 'What is GenLayer?' intro -> Simplified Chinese",
        URL, ANCHOR, 420, "zh-CN", json.dumps(GLOSSARY, ensure_ascii=False),
        "Technical documentation tone; keep product names (GenLayer) in English.",
        120, 3, 50,
    ], value=10**18)
elif cmd == "submit":
    text = Path(sys.argv[3]).read_text().strip()
    job = int(sys.argv[4]) if len(sys.argv) > 4 else read("get_job_count") - 1
    send(sys.argv[2], "submit_translation", [job, text])
elif cmd in ("judge", "appeal", "finalize"):
    job = int(sys.argv[3]) if len(sys.argv) > 3 else read("get_job_count") - 1
    send(sys.argv[2], cmd, [job])
elif cmd == "wait":
    r = wait(sys.argv[2], retries=int(sys.argv[3]) if len(sys.argv) > 3 else 20)
    res = r.get("consensus_data", {}) or {}
    print(r.get("status_name"), r.get("result_name"))
    lr = (res.get("leader_receipt") or [{}])
    lr = lr[0] if isinstance(lr, list) else lr
    print("result:", str(lr.get("result"))[:300], "| exec:", lr.get("execution_result"))
    print("votes:", res.get("votes"))
elif cmd == "show":
    job = int(sys.argv[2]) if len(sys.argv) > 2 else read("get_job_count") - 1
    print(json.dumps(read("get_job", [job]), indent=2, ensure_ascii=False))
