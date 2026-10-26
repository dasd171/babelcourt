"""Shared helpers for BabelCourt scripts (Studionet by default).

Keys: the deployer key is read from .deployer.json ({"pk": ...}); demo actors
(requester / translators) are throwaway keys generated once into
.accounts.json. Both files are git-ignored and hold test-only keys.
"""

import json
import os
import sys
import time
from pathlib import Path

from eth_account import Account
from genlayer_py import create_client
from genlayer_py.chains import studionet, testnet_bradbury
from genlayer_py.types import TransactionStatus

ROOT = Path(__file__).resolve().parent.parent
NETWORK = os.environ.get("GL_NETWORK", "studionet")
CHAIN = {"studionet": studionet, "bradbury": testnet_bradbury}[NETWORK]
DEPLOYMENTS = ROOT / "deployments.json"


def deployer():
    return Account.from_key(json.loads((ROOT / ".deployer.json").read_text())["pk"])


def actors():
    p = ROOT / ".accounts.json"
    if not p.exists():
        data = {n: Account.create().key.hex() for n in ("requester", "alice", "bob", "carol")}
        p.write_text(json.dumps(data))
        os.chmod(p, 0o600)
    return {n: Account.from_key(k) for n, k in json.loads(p.read_text()).items()}


def client(acct=None):
    return create_client(chain=CHAIN, account=acct or deployer())


def deployments():
    return json.loads(DEPLOYMENTS.read_text()) if DEPLOYMENTS.exists() else {}


def save_deployment(key, value):
    d = deployments()
    d.setdefault(NETWORK, {})[key] = value
    DEPLOYMENTS.write_text(json.dumps(d, indent=2))


def address():
    return deployments()[NETWORK]["contract"]


def wait(tx, acct=None, retries=20, interval=5000):
    return client(acct).wait_for_transaction_receipt(
        transaction_hash=tx, status=TransactionStatus.ACCEPTED, interval=interval, retries=retries
    )


def status(tx):
    c = client()
    r = c.get_transaction(transaction_hash=tx)
    return r


def read(fn, args=None):
    return client().read_contract(address=address(), function_name=fn, args=args or [])
