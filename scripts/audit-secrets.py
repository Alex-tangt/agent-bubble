"""Audit git-distributable source and optional APK without printing secret values."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--apk", type=Path, help="Also inspect decompressed APK entries")
args = parser.parse_args()
names = ("DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "AGENT_BUBBLE_TOKEN", "MEMORY_BASE_TOKEN")
values = dict(os.environ)
if (root / ".env").exists():
    for line in (root / ".env").read_text(encoding="utf-8-sig").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"\'')
secrets = [values[name].encode() for name in names if values.get(name) and len(values[name]) >= 12]
patterns = {
    "provider-key": re.compile(rb"\bsk-[A-Za-z0-9_.-]{24,}"),
    "github-token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
    "private-key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "personal-path": re.compile(rb"C:[/\\]+Users[/\\]+(?!Public|user|YOUR_USER|<|%)[A-Za-z0-9_.-]+[/\\]"),
}
environment = {key: value for key, value in os.environ.items() if key not in names}
files = subprocess.check_output(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=root, env=environment).decode().split("\0")
findings = []
def inspect(label, body):
    if any(secret in body for secret in secrets):
        findings.append((label, "configured-credential"))
    for kind, pattern in patterns.items():
        if pattern.search(body):
            findings.append((label, kind))
for name in sorted(set(filter(None, files))):
    path = root / name
    if path.is_file():
        inspect(name, path.read_bytes())
if args.apk:
    with zipfile.ZipFile(args.apk) as archive:
        for entry in archive.namelist():
            inspect("APK:" + entry, archive.read(entry))
if findings:
    for label, kind in findings:
        print("FAIL", kind, label)
    raise SystemExit(1)
print(f"PASS: {len(set(filter(None, files)))} distributable files audited" + ("; APK entries audited" if args.apk else ""))
