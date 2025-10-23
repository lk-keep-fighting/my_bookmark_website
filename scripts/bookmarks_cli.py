#!/usr/bin/env python3
"""Utility CLI for collecting browser bookmarks, converting them into a
canonical JSON representation, and generating a static navigation site."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


def _node_id() -> str:
    return uuid.uuid4().hex


@dataclass
class BookmarkNode:
    """Canonically represents either a folder or a bookmark entry."""

    type: str
    name: str
    id: str = field(default_factory=_node_id)
    url: Optional[str] = None
    children: Optional[List["BookmarkNode"]] = None
    add_date: Optional[str] = None
    last_modified: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None

    def to_dict(self) -> Dict:
        data = {
            "type": self.type,
            "name": self.name,
            "id": self.id,
        }
        if self.type == "bookmark":
            data["url"] = self.url
        if self.children is not None:
            data["children"] = [child.to_dict() for child in self.children]
        if self.add_date:
            data["add_date"] = self.add_date
        if self.last_modified:
            data["last_modified"] = self.last_modified
        if self.icon:
            data["icon"] = self.icon
        if self.description:
            data["description"] = self.description
        if self.tags:
            data["tags"] = self.tags
        return data


@dataclass
class BookmarkDocument:
    root: BookmarkNode
    source: str
    generator: str = "bookmarks_cli"
    version: int = 1
    generated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def total_counts(self) -> Tuple[int, int]:
        def _walk(node: BookmarkNode) -> Tuple[int, int]:
            if node.type == "bookmark":
                return (0, 1)
            folders = 1
            bookmarks = 0
            for child in node.children or []:
                cf, cb = _walk(child)
                folders += cf
                bookmarks += cb
            return folders, bookmarks

        folder_count, bookmark_count = _walk(self.root)
        # Exclude the synthetic root from the folder count exposed to users.
        return max(folder_count - 1, 0), bookmark_count

    def to_dict(self) -> Dict:
        folders, bookmarks = self.total_counts()
        return {
            "version": self.version,
            "generated_at": self.generated_at,
            "source": self.source,
            "generator": self.generator,
            "statistics": {
                "total_folders": folders,
                "total_bookmarks": bookmarks,
            },
            "root": self.root.to_dict(),
        }


# ---------------------------------------------------------------------------
# Netscape HTML bookmark parsing
# ---------------------------------------------------------------------------


class NetscapeBookmarkParser(HTMLParser):
    """Parses bookmarks exported in the classic Netscape (HTML) format."""

    def __init__(self) -> None:
        super().__init__()
        self.root = BookmarkNode(type="folder", name="All bookmarks", children=[])
        self._stack: List[BookmarkNode] = [self.root]
        self._pending_folder: Optional[BookmarkNode] = None
        self._current_target: Optional[Tuple[str, BookmarkNode]] = None

    # HTMLParser overrides -------------------------------------------------
    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        attrs_dict = {k.lower(): (v or "") for k, v in attrs}
        tag = tag.lower()

        if tag == "dl":
            if self._pending_folder is not None:
                folder = self._pending_folder
                self._stack[-1].children.append(folder)
                self._stack.append(folder)
                self._pending_folder = None
            return

        if tag == "dt":  # Marks the beginning of a new node definition
            self._current_target = None
            return

        if tag == "h1":
            # Some exports wrap the root folder in <H1>. Capture as root name.
            self._current_target = ("folder", self.root)
            return

        if tag == "h3":
            folder = BookmarkNode(
                type="folder",
                name="",
                children=[],
                add_date=attrs_dict.get("add_date"),
                last_modified=attrs_dict.get("last_modified"),
            )
            if attrs_dict.get("personal_toolbar_folder") == "true":
                folder.tags = ["toolbar"]
            self._pending_folder = folder
            self._current_target = ("folder", folder)
            return

        if tag == "a":
            bookmark = BookmarkNode(
                type="bookmark",
                name="",
                url=attrs_dict.get("href", ""),
                add_date=attrs_dict.get("add_date"),
                last_modified=attrs_dict.get("last_modified"),
                icon=attrs_dict.get("icon") or attrs_dict.get("icon_uri"),
            )
            tags = attrs_dict.get("tags")
            if tags:
                bookmark.tags = [t.strip() for t in tags.split(",") if t.strip()]
            self._stack[-1].children.append(bookmark)
            self._current_target = ("bookmark", bookmark)
            return

        if tag == "dd":
            # Description for the last bookmark or folder.
            if self._stack[-1].children:
                last_node = self._stack[-1].children[-1]
                self._current_target = ("description", last_node)
            return

        # Any other tags are ignored.
        self._current_target = None

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "dl":
            if len(self._stack) > 1:
                self._stack.pop()
        elif tag in {"h1", "h3", "a", "dd"}:
            self._current_target = None

    def handle_data(self, data: str) -> None:
        if not data or not data.strip():
            return
        if self._current_target is None:
            return
        kind, node = self._current_target
        text = data.strip()
        if kind in {"folder", "bookmark"}:
            node.name = (node.name + " " + text).strip()
        elif kind == "description":
            existing = node.description or ""
            separator = "\n" if existing else ""
            node.description = f"{existing}{separator}{text}".strip()


# ---------------------------------------------------------------------------
# Chrome/Chromium JSON parsing
# ---------------------------------------------------------------------------


def _convert_chrome_node(node: Dict) -> Optional[BookmarkNode]:
    node_type = node.get("type")
    name = node.get("name", "")
    date_added = node.get("date_added")
    date_modified = node.get("date_modified") or node.get("date_last_used")

    if node_type == "folder":
        children_nodes = [
            converted
            for child in node.get("children", [])
            if (converted := _convert_chrome_node(child)) is not None
        ]
        folder = BookmarkNode(
            type="folder",
            name=name,
            children=children_nodes,
            add_date=date_added,
            last_modified=date_modified,
        )
        if node.get("special"):
            folder.tags = [node["special"]]
        return folder

    if node_type in {"url", "bookmark"}:
        return BookmarkNode(
            type="bookmark",
            name=name,
            url=node.get("url", ""),
            add_date=date_added,
            last_modified=date_modified,
        )

    # Ignore separators and other metadata entries.
    return None


def convert_chrome_bookmarks(raw: Dict) -> BookmarkNode:
    roots = raw.get("roots", {})
    root_children: List[BookmarkNode] = []
    preferred_order = ["bookmark_bar", "other", "synced", "mobile", "trash"]

    for key in preferred_order:
        root_data = roots.get(key)
        if not root_data:
            continue
        converted = _convert_chrome_node(root_data)
        if converted:
            if converted.name.lower() in {"bookmark bar", "书签栏"}:
                converted.tags = (converted.tags or []) + ["toolbar"]
            root_children.append(converted)

    # Add any other remaining roots.
    for key, value in roots.items():
        if any(child for child in root_children if child.name == value.get("name")):
            continue
        converted = _convert_chrome_node(value)
        if converted:
            root_children.append(converted)

    return BookmarkNode(type="folder", name="All bookmarks", children=root_children)


def _node_from_canonical(data: Dict) -> BookmarkNode:
    node_type = data.get("type", "folder")
    name = data.get("name", "")
    node_id = data.get("id") or _node_id()
    add_date = data.get("add_date")
    last_modified = data.get("last_modified")
    icon = data.get("icon")
    description = data.get("description")
    tags = data.get("tags")
    if isinstance(tags, str):
        tags = [tags]

    if node_type == "folder":
        children_data = data.get("children") or []
        children = [_node_from_canonical(child) for child in children_data]
        return BookmarkNode(
            type="folder",
            name=name,
            id=node_id,
            children=children,
            add_date=add_date,
            last_modified=last_modified,
            icon=icon,
            description=description,
            tags=tags,
        )

    return BookmarkNode(
        type="bookmark",
        name=name,
        id=node_id,
        url=data.get("url", ""),
        add_date=add_date,
        last_modified=last_modified,
        icon=icon,
        description=description,
        tags=tags,
    )


# ---------------------------------------------------------------------------
# Bookmark document loader
# ---------------------------------------------------------------------------


def parse_bookmarks_file(path: Path) -> BookmarkDocument:
    if not path.exists():
        raise FileNotFoundError(f"Input file not found: {path}")

    suffix = path.suffix.lower()
    if suffix in {".html", ".htm"}:
        parser = NetscapeBookmarkParser()
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            parser.feed(handle.read())
        parser.close()
        document = BookmarkDocument(root=parser.root, source=str(path))
        return document

    # Fallback to JSON (Chrome & Chromium based browsers / canonical JSON)
    with path.open("r", encoding="utf-8") as handle:
        raw_json = json.load(handle)

    if isinstance(raw_json, dict) and "roots" in raw_json:
        root = convert_chrome_bookmarks(raw_json)
        document = BookmarkDocument(root=root, source=str(path))
        return document

    if isinstance(raw_json, dict) and "root" in raw_json:
        root_node = _node_from_canonical(raw_json["root"])
        document = BookmarkDocument(root=root_node, source=str(path))
        document.version = raw_json.get("version", document.version)
        document.generator = raw_json.get("generator", document.generator)
        document.generated_at = raw_json.get("generated_at", document.generated_at)
        return document

    raise ValueError(
        "Unsupported bookmark JSON format. Expecting Chromium 'Bookmarks' structure or canonical bookmarks.json."
    )


# ---------------------------------------------------------------------------
# Browser bookmark discovery helpers
# ---------------------------------------------------------------------------


def _browser_path_templates() -> Dict[str, Dict[str, str]]:
    return {
        "chrome": {
            "Windows": r"{LOCALAPPDATA}\\Google\\Chrome\\User Data\\{profile}\\Bookmarks",
            "Darwin": "{HOME}/Library/Application Support/Google/Chrome/{profile}/Bookmarks",
            "Linux": "{HOME}/.config/google-chrome/{profile}/Bookmarks",
        },
        "chromium": {
            "Windows": r"{LOCALAPPDATA}\\Chromium\\User Data\\{profile}\\Bookmarks",
            "Darwin": "{HOME}/Library/Application Support/Chromium/{profile}/Bookmarks",
            "Linux": "{HOME}/.config/chromium/{profile}/Bookmarks",
        },
        "edge": {
            "Windows": r"{LOCALAPPDATA}\\Microsoft\\Edge\\User Data\\{profile}\\Bookmarks",
            "Darwin": "{HOME}/Library/Application Support/Microsoft Edge/{profile}/Bookmarks",
            "Linux": "{HOME}/.config/microsoft-edge/{profile}/Bookmarks",
        },
        "brave": {
            "Windows": r"{LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\User Data\\{profile}\\Bookmarks",
            "Darwin": "{HOME}/Library/Application Support/BraveSoftware/Brave-Browser/{profile}/Bookmarks",
            "Linux": "{HOME}/.config/BraveSoftware/Brave-Browser/{profile}/Bookmarks",
        },
        "vivaldi": {
            "Windows": r"{LOCALAPPDATA}\\Vivaldi\\User Data\\{profile}\\Bookmarks",
            "Darwin": "{HOME}/Library/Application Support/Vivaldi/{profile}/Bookmarks",
            "Linux": "{HOME}/.config/vivaldi/{profile}/Bookmarks",
        },
    }


def resolve_browser_bookmark_path(browser: str, profile: str) -> Optional[Path]:
    templates = _browser_path_templates()
    browser = browser.lower()
    system = platform.system()

    if browser not in templates:
        raise ValueError(f"Unsupported browser '{browser}'. Supported: {', '.join(sorted(templates))}")

    system_templates = templates[browser]
    template = system_templates.get(system)
    if not template:
        return None

    substitutions = {
        "HOME": str(Path.home()),
        "LOCALAPPDATA": os.environ.get("LOCALAPPDATA", ""),
        "profile": profile,
    }
    # Expand nested env vars first
    for key, value in list(substitutions.items()):
        if value:
            substitutions[key] = os.path.expandvars(value)

    path_str = template.format(**substitutions)
    expanded = os.path.expandvars(path_str)
    return Path(expanded)


# ---------------------------------------------------------------------------
# Site generation helpers
# ---------------------------------------------------------------------------


def build_static_site(
    document: BookmarkDocument,
    site_dir: Path,
    static_source: Optional[Path] = None,
) -> None:
    if static_source is None:
        static_source = Path(__file__).resolve().parent.parent / "web"

    if not static_source.exists():
        raise FileNotFoundError(f"Static template directory not found: {static_source}")

    site_dir.mkdir(parents=True, exist_ok=True)
    shutil.copytree(static_source, site_dir, dirs_exist_ok=True)

    json_path = site_dir / "bookmarks.json"
    with json_path.open("w", encoding="utf-8") as handle:
        json.dump(document.to_dict(), handle, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# CLI interface
# ---------------------------------------------------------------------------


def cmd_gather(args: argparse.Namespace) -> None:
    profile = args.profile or "Default"
    target_path = resolve_browser_bookmark_path(args.browser, profile)
    if target_path is None:
        print(f"Unsupported combination for browser '{args.browser}' on this platform.", file=sys.stderr)
        sys.exit(2)

    if not target_path.exists():
        print(f"Could not locate bookmark file for browser '{args.browser}' profile '{profile}'.", file=sys.stderr)
        print(f"Looked for: {target_path}", file=sys.stderr)
        sys.exit(1)

    destination = Path(args.destination).expanduser()
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(target_path, destination)

    print(f"Bookmarks copied to {destination}")


def cmd_convert(args: argparse.Namespace) -> None:
    input_path = Path(args.input).expanduser()
    document = parse_bookmarks_file(input_path)

    output_path = Path(args.output).expanduser()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(document.to_dict(), handle, indent=2, ensure_ascii=False)

    print(f"Canonical JSON saved to {output_path}")

    if args.site_dir:
        site_dir = Path(args.site_dir).expanduser()
        static_source = Path(args.static_dir).expanduser() if args.static_dir else None
        build_static_site(document, site_dir, static_source)
        print(f"Static site refreshed at {site_dir}")


def cmd_build(args: argparse.Namespace) -> None:
    input_path = Path(args.input).expanduser()
    document = parse_bookmarks_file(input_path)

    site_dir = Path(args.site_dir).expanduser()
    static_source = Path(args.static_dir).expanduser() if args.static_dir else None
    build_static_site(document, site_dir, static_source)

    print(f"Static site generated at {site_dir}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Parse browser bookmarks and generate a searchable navigation site.",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # gather ---------------------------------------------------------------
    gather = subparsers.add_parser(
        "gather",
        help="Locate and copy a Chromium-based browser's bookmark database",
    )
    gather.add_argument("browser", help="Browser to gather from", choices=sorted(_browser_path_templates().keys()))
    gather.add_argument(
        "--profile",
        default="Default",
        help="Profile directory to read (Default, Profile 1, ...)",
    )
    gather.add_argument(
        "--destination",
        default="data/raw/{browser}_{profile}_Bookmarks.json",
        help="Destination file to copy into (default: data/raw/<browser>_<profile>_Bookmarks.json)",
    )
    gather.set_defaults(func=cmd_gather)

    # convert --------------------------------------------------------------
    convert = subparsers.add_parser(
        "convert",
        help="Convert an exported bookmark file into the canonical JSON format",
    )
    convert.add_argument("input", help="Path to the exported bookmark file (.json or .html)")
    convert.add_argument(
        "--output",
        default="data/bookmarks.json",
        help="Where to store the canonical JSON (default: data/bookmarks.json)",
    )
    convert.add_argument(
        "--site-dir",
        help="Optional output directory for the generated static site",
    )
    convert.add_argument(
        "--static-dir",
        help="Custom static template directory (defaults to the bundled 'web' directory)",
    )
    convert.set_defaults(func=cmd_convert)

    # build-site -----------------------------------------------------------
    build = subparsers.add_parser(
        "build-site",
        help="Generate / refresh the static navigation site using the provided bookmark file",
    )
    build.add_argument("input", help="Path to the exported bookmark file (.json or .html)")
    build.add_argument("site_dir", help="Directory where the static site should be written")
    build.add_argument(
        "--static-dir",
        help="Custom static template directory (defaults to the bundled 'web' directory)",
    )
    build.set_defaults(func=cmd_build)

    return parser


def main(argv: Optional[Iterable[str]] = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    # Normalise destination string for gather subcommand
    if args.command == "gather":
        args.destination = args.destination.format(browser=args.browser, profile=args.profile)

    args.func(args)


if __name__ == "__main__":
    main()
