import functools
import json
import re
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

LINKS_JSON = "links.json"
CITATIONS_JSON = "citations.json"

CODE_SPAN = re.compile(r"`([^`\n]+)`")
CITATION = re.compile(
    r"(?P<path>(?:src|deps)/[^\s:`*]+?)/?(?::(?P<ranges>\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*))?"
)
SOURCE_FILE = re.compile(
    r"[\w.@+*/-]*\.(?:rs|go|c|h|cc|cpp|hpp|s|S|inc|toml|nix|proto|py|sh|mod)(?::[\d,-]+)?"
)
CHECKLIST_ITEM = re.compile(r"\s*- \[[ x]\] \*\*(?P<name>.+?)\*\*")
GLANCE_ITEM = re.compile(r"\s*- \*\*(?P<name>[^*]+?):\*\*")
PSEUDO_VERSION = re.compile(r"[.-]\d{14}-(?P<rev>[0-9a-f]{12})(?:\+incompatible)?$")
MAJOR_SUFFIX = re.compile(r"v\d+")
GITHUB_RELEASE = re.compile(
    r"https://github\.com/(?P<repo>[^/]+/[^/]+)/releases/download/(?P<tag>[^/]+)/"
)
GITHUB_GIT_SOURCE = re.compile(
    r"git\+https://github\.com/(?P<repo>[^/?#]+/[^/?#]+?)(?:\.git)?(?:\?[^#]*)?#(?P<rev>[0-9a-f]{40})"
)
GNU_MIRROR = "mirror://gnu/"

# Go modules whose import path is not the repository that hosts them.
GO_VANITY_REPOS = {
    "golang.zx2c4.com/wireguard": ("https://git.zx2c4.com/wireguard-go", "cgit"),
}

type Ranges = tuple[tuple[int, int], ...]


class LinkSpec(TypedDict, total=False):
    kind: str
    url: str
    lines: str


class CitationsJson(TypedDict):
    links: dict[str, str]
    items: dict[str, list[str]]


class UnlinkableError(ValueError):
    pass


@dataclass(frozen=True)
class Citation:
    text: str
    path: str
    ranges: Ranges


def parse_citation(text: str) -> Citation | None:
    """Parse an inline-code citation such as `src/nebula/udp/udp_linux.go:120-131`.

    Args:
        text: Content of one inline code span.

    Returns:
        The citation, or None if the span is not a `src/` or `deps/` citation.
    """
    match = CITATION.fullmatch(text)
    if match is None:
        return None
    ranges = []
    for part in match["ranges"].split(",") if match["ranges"] else []:
        start, _, end = part.partition("-")
        ranges.append((int(start), int(end or start)))
    return Citation(text=text, path=match["path"], ranges=tuple(ranges))


def _item_name(line: str) -> str | None:
    match = CHECKLIST_ITEM.match(line) or GLANCE_ITEM.match(line)
    return match["name"] if match else None


def overview_items(markdown: str) -> dict[str, list[str]]:
    """Collect the citations of every checklist item and At a Glance bullet.

    Args:
        markdown: Content of an overview.md.

    Returns:
        Item name to the citations in its text, in order of appearance. An item's
        text runs on over indented continuation lines.
    """
    items: dict[str, list[str]] = {}
    current: list[str] | None = None
    for line in markdown.splitlines():
        name = _item_name(line)
        if name is not None:
            current = items.setdefault(name, [])
        elif current is None or not line.startswith((" ", "\t")):
            current = None
            continue
        for span in CODE_SPAN.findall(line):
            if parse_citation(span) is not None:
                current.append(span)
    return items


def _spec_for(path: str, specs: dict[str, LinkSpec]) -> tuple[LinkSpec, str]:
    for key in sorted(specs, key=len, reverse=True):
        if path == key or path.startswith(f"{key}/"):
            return specs[key], path[len(key) + 1 :]
    msg = f"no {LINKS_JSON} entry covers `{path}`"
    raise UnlinkableError(msg)


def _anchor(style: str, ranges: Ranges) -> str:
    if not ranges:
        return ""
    start, end = ranges[0]
    if style == "cgit":
        return f"#n{start}"
    if style == "docsrs":
        return f"#{start}" if start == end else f"#{start}-{end}"
    return f"#L{start}" if start == end else f"#L{start}-L{end}"


def _file_url(template: str, style: str, rel: str, ranges: Ranges) -> str:
    url = template.replace("{path}", rel)
    if style == "github" and ranges and rel.endswith(".md"):
        url += "?plain=1"
    return url + _anchor(style, ranges)


@functools.cache
def _go_modules(modules_txt: Path) -> dict[str, tuple[str, str]]:
    modules = {}
    for line in modules_txt.read_text().splitlines():
        if not line.startswith("# "):
            continue
        fields = line[2:].split()
        if "=>" in fields:
            arrow = fields.index("=>")
            target = fields[arrow + 1 :]
            if len(target) == 2:
                modules[fields[0]] = (target[0], target[1])
        elif len(fields) == 2:
            modules[fields[0]] = (fields[0], fields[1])
    return modules


def _go_repo(module: str) -> tuple[str, str, str] | None:
    for vanity, (base, style) in GO_VANITY_REPOS.items():
        if module == vanity:
            return base, style, ""
    parts = module.split("/")
    if parts[0] == "github.com" and len(parts) >= 3:
        return (
            f"https://github.com/{parts[1]}/{parts[2]}",
            "github",
            "/".join(parts[3:]),
        )
    if parts[:2] == ["golang.org", "x"] and len(parts) == 3:
        return f"https://github.com/golang/{parts[2]}", "github", ""
    return None


def _go_source_url(module: str, version: str, subpath: str, ranges: Ranges) -> str:
    repo = _go_repo(module)
    subdir = repo[2] if repo else ""
    if repo is None or any(MAJOR_SUFFIX.fullmatch(part) for part in subdir.split("/")):
        # Unknown host, or a major-version suffix that may or may not be a directory.
        return f"https://pkg.go.dev/{module}@{version}"
    base, style, subdir = repo
    pseudo = PSEUDO_VERSION.search(version)
    tag = version.removesuffix("+incompatible")
    ref = pseudo["rev"] if pseudo else (f"{subdir}/{tag}" if subdir else tag)
    path = f"{subdir}/{subpath}" if subdir else subpath
    if style == "cgit":
        return _file_url(f"{base}/tree/{{path}}?id={ref}", style, path, ranges)
    return _file_url(f"{base}/blob/{ref}/{{path}}", style, path, ranges)


def _go_module_url(root: Path, rel: str, ranges: Ranges) -> str:
    modules = _go_modules(root / "modules.txt")
    for module in sorted(modules, key=len, reverse=True):
        if rel.startswith(f"{module}/") or rel == module:
            source, version = modules[module]
            return _go_source_url(source, version, rel[len(module) + 1 :], ranges)
    msg = f"`{rel}` is not inside a vendored Go module"
    raise UnlinkableError(msg)


def _git_crate_url(vendor: Path, name: str, version: str) -> str:
    lock = tomllib.loads((vendor / "Cargo.lock").read_text())
    for package in lock.get("package", []):
        if package.get("name") != name or package.get("version") != version:
            continue
        match = GITHUB_GIT_SOURCE.match(package.get("source", ""))
        if match:
            return f"https://github.com/{match['repo']}/tree/{match['rev']}"
    msg = f"git crate {name} {version} has no GitHub source in Cargo.lock"
    raise UnlinkableError(msg)


def _crate_url(vendor: Path, crate: Path, subpath: str, ranges: Ranges) -> str:
    package = tomllib.loads((crate / "Cargo.toml").read_text())["package"]
    name, version = package["name"], package["version"]
    checksum = json.loads((crate / ".cargo-checksum.json").read_text())
    if checksum.get("package") is None:
        return _git_crate_url(vendor, name, version)
    template = f"https://docs.rs/crate/{name}/{version}/source/{{path}}"
    return _file_url(template, "docsrs", subpath, ranges)


def _cargo_url(root: Path, rel: str, ranges: Ranges) -> str:
    parts = rel.split("/")
    # Crates sit at `<crate>-<version>/` or, in crane's layout, `<registry hash>/<crate>-<version>/`.
    for depth in (1, 2):
        crate = root.joinpath(*parts[:depth])
        if (crate / ".cargo-checksum.json").is_file():
            return _crate_url(root, crate, "/".join(parts[depth:]), ranges)
    msg = f"`{rel}` is not inside a vendored crate"
    raise UnlinkableError(msg)


def _archive_url(url: str) -> str:
    release = GITHUB_RELEASE.match(url)
    if release:
        return f"https://github.com/{release['repo']}/tree/{release['tag']}"
    if url.startswith(GNU_MIRROR):
        return "https://ftp.gnu.org/gnu/" + url.removeprefix(GNU_MIRROR)
    return url


def citation_url(citation: Citation, sources: Path, specs: dict[str, LinkSpec]) -> str:
    """Return where a citation can be read online at the analyzed version.

    Args:
        citation: A parsed citation.
        sources: The workspace's `sources` folder.
        specs: Content of `sources/links.json`.

    Returns:
        A URL to the cited lines, or for dependencies without a browsable
        repository, to the dependency at the analyzed version.

    Raises:
        UnlinkableError: If no link can be built for the citation.
    """
    spec, rel = _spec_for(citation.path, specs)
    key = citation.path.removesuffix(rel).rstrip("/")
    kind = spec.get("kind")
    if kind == "file":
        return _file_url(spec["url"], spec["lines"], rel, citation.ranges)
    if kind == "go-modules":
        return _go_module_url(sources / key, rel, citation.ranges)
    if kind == "cargo-vendor":
        return _cargo_url(sources / key, rel, citation.ranges)
    if kind == "archive":
        return _archive_url(spec["url"])
    msg = f"unknown link kind {kind!r} for `{key}`"
    raise UnlinkableError(msg)


def _line_problems(citation: Citation, sources: Path) -> list[str]:
    target = sources / citation.path
    if not target.exists():
        return [f"`{citation.text}`: {citation.path} does not exist in sources/"]
    if not citation.ranges:
        return []
    if not target.is_file():
        return [f"`{citation.text}`: line numbers on a directory"]
    with target.open("rb") as f:
        count = sum(1 for _ in f)
    bad = [f"{a}-{b}" for a, b in citation.ranges if not 1 <= a <= b <= count]
    if bad:
        return [f"`{citation.text}`: lines {', '.join(bad)} outside 1-{count}"]
    return []


def _span_problems(markdown: str) -> list[str]:
    problems = []
    for span in dict.fromkeys(CODE_SPAN.findall(markdown)):
        if parse_citation(span) is None and SOURCE_FILE.fullmatch(span):
            problems.append(
                f"`{span}` is not a full citation, write src/<input>/... or "
                "deps/<input>/<dep>/... with no `sources/`, `...` or `*`"
            )
    return problems


def citation_report(markdown: str, sources: Path) -> tuple[CitationsJson, list[str]]:
    """Link every citation of an overview and check it against the sources.

    Args:
        markdown: Content of overview.md.
        sources: The workspace's `sources` folder, holding `links.json`.

    Returns:
        The citations.json content for the web UI, and human-readable problems:
        abbreviated citations, cited files or lines that do not exist, citations
        that cannot be linked, and items that cite nothing.
    """
    specs: dict[str, LinkSpec] = json.loads((sources / LINKS_JSON).read_text())
    problems = _span_problems(markdown)
    links = {}
    for span in dict.fromkeys(CODE_SPAN.findall(markdown)):
        citation = parse_citation(span)
        if citation is None:
            continue
        problems.extend(_line_problems(citation, sources))
        try:
            links[span] = citation_url(citation, sources, specs)
        except UnlinkableError as e:
            problems.append(f"`{span}`: {e}")
    items = overview_items(markdown)
    problems.extend(
        f"item `{name}` cites no source" for name, cited in items.items() if not cited
    )
    return {"links": links, "items": items}, problems
