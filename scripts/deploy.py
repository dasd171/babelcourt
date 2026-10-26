"""Deploy contracts/babel_court.py. Usage: python scripts/deploy.py"""
import sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from glc import *  # noqa

code = (ROOT / "contracts" / "babel_court.py").read_text()
acct = deployer()
c = client(acct)
tx = c.deploy_contract(code=code, args=[])
print("deploy tx", tx.hex() if hasattr(tx, "hex") else tx)
save_deployment("deploy_tx", tx.hex() if hasattr(tx, "hex") else str(tx))
