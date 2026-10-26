"""Deploy frontend/dist to Vercel as a static site (token via $VERCEL_TOKEN)."""
import base64, json, os, sys, urllib.request
from pathlib import Path

dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
files = []
for p in sorted(dist.rglob("*")):
    if p.is_file():
        files.append({"file": str(p.relative_to(dist)), "data": base64.b64encode(p.read_bytes()).decode(), "encoding": "base64"})
body = {"name": "babelcourt", "target": "production", "projectSettings": {"framework": None, "buildCommand": "", "outputDirectory": ".", "installCommand": ""}, "files": files}
req = urllib.request.Request("https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1", data=json.dumps(body).encode(),
                             headers={"Authorization": "Bearer " + os.environ["VERCEL_TOKEN"], "Content-Type": "application/json"}, method="POST")
try:
    r = json.load(urllib.request.urlopen(req, timeout=100))
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode()[:800]); sys.exit(1)
print(json.dumps({k: r.get(k) for k in ("id", "url", "readyState", "alias", "projectId")}, indent=1))
