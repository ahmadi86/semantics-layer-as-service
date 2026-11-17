"""Prepare the static site for deployment below a GitHub Pages base path."""

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path


TEXT_ASSET_SUFFIXES = {".html", ".js", ".css"}
ROOT_PATH_IN_STRING = re.compile(r"(?P<quote>[\"'`])/(?=[A-Za-z0-9])")


def normalized_base_path(value: str) -> str:
    if not value or value == "/":
        return ""
    return f"/{value.strip('/')}"


def add_base_path(content: str, base_path: str) -> str:
    if not base_path:
        return content

    content = ROOT_PATH_IN_STRING.sub(
        lambda match: f"{match.group('quote')}{base_path}/", content
    )
    content = content.replace('href="/"', f'href="{base_path}/"')
    content = content.replace("href='/'", f"href='{base_path}/'")
    return content.replace("|/", f"|{base_path}/")


def prepare_site(source: Path, destination: Path, base_path: str) -> None:
    if not source.is_dir():
        raise FileNotFoundError(f"Site directory does not exist: {source}")

    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(source, destination)

    normalized_base = normalized_base_path(base_path)
    for asset in destination.rglob("*"):
        if asset.is_file() and asset.suffix.lower() in TEXT_ASSET_SUFFIXES:
            original = asset.read_text(encoding="utf-8")
            prepared = add_base_path(original, normalized_base)
            asset.write_text(prepared, encoding="utf-8", newline="")

    (destination / ".nojekyll").touch()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--base-path", default="")
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    prepare_site(arguments.source, arguments.destination, arguments.base_path)
