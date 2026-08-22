from __future__ import annotations

import pathlib
import re
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2"}
PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b"),
    "Discord token": re.compile(r"\b[A-Za-z\d_-]{23,28}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{20,}\b"),
    "Slack token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
}
SECRET_ASSIGNMENT = re.compile(
    r"(?im)^[ \t]*(?:DISCORD_BOT_TOKEN|CONTROL_DISCORD_CLIENT_SECRET|AGENT_AUTH_SECRET|"
    r"AGENT_PREVIOUS_AUTH_SECRET|INTERNAL_STATUS_SECRET)[ \t]*=[ \t]*([^\s#][^\r\n]*)$"
)
PLACEHOLDERS = ("replace", "example", "changeme", "<", "${")


def candidate_files() -> list[pathlib.Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return [ROOT / line for line in result.stdout.splitlines() if line]


def main() -> int:
    findings: list[str] = []
    for path in candidate_files():
        if not path.is_file() or path.suffix.lower() in SKIP_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        relative = path.relative_to(ROOT).as_posix()
        for label, pattern in PATTERNS.items():
            if pattern.search(text):
                findings.append(f"{relative}: possible {label}")
        for match in SECRET_ASSIGNMENT.finditer(text):
            value = match.group(1).strip().lower()
            if value and not value.startswith(PLACEHOLDERS):
                findings.append(f"{relative}:{text.count(chr(10), 0, match.start()) + 1}: populated secret assignment")
    if findings:
        print("Secret scan failed:")
        print("\n".join(sorted(set(findings))))
        return 1
    print(f"Secret scan passed across {len(candidate_files())} tracked and untracked candidate files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
