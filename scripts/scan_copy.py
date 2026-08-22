from __future__ import annotations

import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {".md", ".txt", ".ts", ".tsx", ".json", ".jsonc", ".yaml", ".yml"}
FORBIDDEN = {
    "inflated readiness claim": re.compile(r"\bproduction[- ]ready\b", re.IGNORECASE),
    "generic superlative": re.compile(r"\b(?:revolutionary|cutting-edge|game-changing|world-class)\b", re.IGNORECASE),
    "assistant filler": re.compile(r"\b(?:delve into|in today's fast-paced|as an ai|it is worth noting)\b", re.IGNORECASE),
    "unsupported certainty": re.compile(r"\b(?:guaranteed secure|completely secure|zero risk)\b", re.IGNORECASE),
}


def files_for(argument: str) -> list[pathlib.Path]:
    path = (ROOT / argument).resolve()
    if not path.exists():
        return []
    if path.is_file():
        return [path]
    return [candidate for candidate in path.rglob("*") if candidate.is_file()]


def main() -> int:
    arguments = sys.argv[1:] or ["README.md", "docs", "skills"]
    findings: list[str] = []
    checked = 0
    for argument in arguments:
        for path in files_for(argument):
            if path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            checked += 1
            text = path.read_text(encoding="utf-8")
            for label, pattern in FORBIDDEN.items():
                for match in pattern.finditer(text):
                    line = text.count("\n", 0, match.start()) + 1
                    findings.append(f"{path.relative_to(ROOT).as_posix()}:{line}: {label}: {match.group(0)}")
    if findings:
        print("Copy triage failed:")
        print("\n".join(findings))
        return 1
    print(f"Copy triage passed across {checked} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
