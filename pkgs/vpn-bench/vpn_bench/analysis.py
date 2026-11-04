import hashlib
import json
import logging
import os
import re
import shutil
from dataclasses import dataclass
from datetime import date
from enum import Enum
from pathlib import Path
from typing import TypedDict

from clan_lib.cmd import Log, RunOpts, run
from clan_lib.errors import ClanError
from clan_lib.nix import nix_command, nix_eval

from vpn_bench.assets import get_analysis_asset
from vpn_bench.citations import CITATIONS_JSON, citation_report
from vpn_bench.data import Config, flake_ref
from vpn_bench.errors import VpnBenchError

log = logging.getLogger(__name__)

VPN_VERSION_JSON = "vpn_version.json"
OVERVIEW_MD = "overview.md"
ANALYSIS_JSON = "analysis.json"
FEATURE_MATRIX_MD = "feature_matrix.md"
PROMPT_MD = "PROMPT.md"
OVERVIEW_PROMPT = "overview_prompt.md"
OVERVIEW_TEMPLATE = "overview_template.md"
MATRIX_PROMPT = "matrix_prompt.md"
MATRIX_ROW_CONTRACT = "matrix_row_contract.md"
MATRIX_SKELETON = "matrix_skeleton.md"
GENERAL_DIR = "General"
MATRIX_STEP = "feature matrix"
FEATURE_HEADER = "| Feature |"
SCORES_MARKER = "<!-- feature-scores -->"
MATRIX_SYMBOLS = frozenset({"✓", "◐", "✗", "N/A", "?"})
SEPARATOR_CELL = re.compile(r":?-{3,}:?")
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
CHECKLIST_VALUE = re.compile(
    r"\s*- \[(?P<box>[ x])\] \*\*(?P<name>.+?)\*\*\s*-\s*(?P<rest>.*)"
)


@dataclass(frozen=True)
class Component:
    input: str
    rev: str
    version: str
    url: str


class ComponentJson(TypedDict):
    input: str
    rev: str
    version: str
    url: str


class VpnAnalysisJson(TypedDict):
    date: str | None
    model: str | None
    revs: dict[str, str]


class MatrixAnalysisJson(TypedDict):
    date: str | None
    model: str | None
    revs: dict[str, dict[str, str]]


class StepStatus(Enum):
    IMPORTED = "imported"
    PENDING = "pending"
    ERROR = "error"


@dataclass(frozen=True)
class StepResult:
    name: str
    status: StepStatus
    detail: str


@dataclass(frozen=True)
class FeatureTable:
    header: str
    rows: tuple[tuple[str, ...], ...]


def load_components(path: Path) -> list[Component]:
    """Parse a vpn_version.json file.

    Args:
        path: The vpn_version.json written by `vpb bench`.

    Returns:
        The components in file order, traffic-carrying one first.
    """
    return _parse_components(path.read_text())


def flake_components(flake: str, vpn: str) -> list[Component]:
    """Evaluate the components the checked-out flake pins for a VPN.

    Args:
        flake: Flake reference of the vpn-benchmark-suite checkout.
        vpn: VPN directory name, also the `vpnVersions` attribute.

    Returns:
        The components of `vpnVersions.<vpn>`.
    """
    out = run(nix_eval([f"{flake}#vpnVersions.{vpn}"]), RunOpts(log=Log.STDERR))
    return _parse_components(out.stdout)


def _parse_components(text: str) -> list[Component]:
    entries: list[ComponentJson] = json.loads(text)
    return [
        Component(
            input=entry["input"],
            rev=entry["rev"],
            version=entry["version"],
            url=entry["url"],
        )
        for entry in entries
    ]


def component_revs(components: list[Component]) -> dict[str, str]:
    return {c.input: c.rev for c in components}


def matrix_revs(components: dict[str, list[Component]]) -> dict[str, dict[str, str]]:
    return {vpn: component_revs(comps) for vpn, comps in components.items()}


def vpn_key(components: list[Component]) -> str:
    """Return the workspace key of a VPN's components.

    Args:
        components: The components of one VPN.

    Returns:
        `<input>-<rev[:12]>` of every component, joined by `_`.
    """
    return "_".join(f"{c.input}-{c.rev[:12]}" for c in components)


def matrix_key(revs: dict[str, dict[str, str]]) -> str:
    """Return the workspace key of a feature matrix.

    Args:
        revs: `{VPN: {input: rev}}` of every VPN in the matrix.

    Returns:
        The first 16 hex digits of the sha256 of the sorted JSON dump.
    """
    digest = hashlib.sha256(json.dumps(revs, sort_keys=True).encode())
    return digest.hexdigest()[:16]


def components_table(components: list[Component]) -> str:
    lines = ["| Input | Version | Rev | Source |", "| --- | --- | --- | --- |"]
    lines.extend(
        f"| {c.input} | {c.version} | {c.rev} | `sources/src/{c.input}` |"
        for c in components
    )
    return "\n".join(lines)


def vpns_table(components: dict[str, list[Component]]) -> str:
    lines = ["| VPN | Components |", "| --- | --- |"]
    for vpn, comps in components.items():
        listed = ", ".join(f"{c.input} {c.version} ({c.rev[:12]})" for c in comps)
        lines.append(f"| {vpn} | {listed} |")
    return "\n".join(lines)


def analysis_json_problems(
    text: str, revs: dict[str, str] | dict[str, dict[str, str]]
) -> list[str]:
    """Check an analysis.json written by the analysing agent.

    Args:
        text: Content of analysis.json.
        revs: The revs the analysis must describe.

    Returns:
        Human-readable problems, empty if the file is valid.
    """
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        return [f"{ANALYSIS_JSON} is not valid JSON: {e}"]
    if not isinstance(data, dict):
        return [f"{ANALYSIS_JSON} is not a JSON object"]
    problems = []
    model = data.get("model")
    if not isinstance(model, str) or not model.strip():
        problems.append(f"{ANALYSIS_JSON}: `model` must be a non-empty string")
    if not _is_iso_date(data.get("date")):
        problems.append(f"{ANALYSIS_JSON}: `date` must be YYYY-MM-DD")
    if data.get("revs") != revs:
        problems.append(f"{ANALYSIS_JSON}: `revs` must be {json.dumps(revs)}")
    return problems


def _is_iso_date(value: object) -> bool:
    if not isinstance(value, str) or not ISO_DATE.fullmatch(value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def overview_problems(text: str) -> list[str]:
    """Check an overview.md written by the analysing agent.

    Args:
        text: Content of overview.md.

    Returns:
        Human-readable problems, empty if the file is valid.
    """
    if not text.strip():
        return [f"{OVERVIEW_MD} is empty"]
    if not text.lstrip().startswith("# "):
        return [f"{OVERVIEW_MD} must start with a `# ` heading"]
    return []


def _cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _is_separator(cells: list[str]) -> bool:
    return all(SEPARATOR_CELL.fullmatch(cell) for cell in cells)


def feature_tables(text: str) -> list[FeatureTable]:
    """Collect the `| Feature |` tables of a matrix document.

    Args:
        text: Markdown of a feature matrix or the matrix skeleton.

    Returns:
        Each table's stripped header line and its rows split into cells,
        separator rows left out.
    """
    tables = []
    lines = [line.strip() for line in text.splitlines()]
    index = 0
    while index < len(lines):
        header = lines[index]
        index += 1
        if not header.startswith(FEATURE_HEADER):
            continue
        rows = []
        while index < len(lines) and lines[index].startswith("|"):
            if lines[index].startswith(FEATURE_HEADER):
                break
            cells = _cells(lines[index])
            if not _is_separator(cells):
                rows.append(tuple(cells))
            index += 1
        tables.append(FeatureTable(header=header, rows=tuple(rows)))
    return tables


def feature_rows(text: str) -> set[str]:
    return {row[0] for table in feature_tables(text) for row in table.rows}


def feature_matrix_problems(text: str, skeleton: str, vpn_count: int) -> list[str]:
    """Check a feature_matrix.md written by the analysing agent.

    Args:
        text: Content of feature_matrix.md.
        skeleton: Content of the matrix_skeleton.md asset.
        vpn_count: Number of VPNs the matrix must have columns for.

    Returns:
        Human-readable problems, empty if the file is valid.
    """
    problems = []
    if SCORES_MARKER not in text:
        problems.append(f"{FEATURE_MATRIX_MD} lacks the {SCORES_MARKER} marker")
    tables = feature_tables(text)
    if not tables:
        return [*problems, f"{FEATURE_MATRIX_MD} has no `{FEATURE_HEADER}` table"]
    if len({table.header for table in tables}) > 1:
        problems.append(f"`{FEATURE_HEADER}` header lines differ between tables")
    columns = len(_cells(tables[0].header)) - 1
    if columns != vpn_count:
        problems.append(f"matrix has {columns} VPN columns, run has {vpn_count}")
    rows = [row for table in tables for row in table.rows]
    problems.extend(_row_problems(rows, columns))
    names = {row[0] for row in rows}
    expected = feature_rows(skeleton)
    if names != expected:
        missing = ", ".join(sorted(expected - names)) or "none"
        unexpected = ", ".join(sorted(names - expected)) or "none"
        problems.append(
            f"feature rows differ from {MATRIX_SKELETON}: "
            f"missing {missing}; unexpected {unexpected}"
        )
    return problems


def _row_problems(rows: list[tuple[str, ...]], columns: int) -> list[str]:
    problems = []
    for row in rows:
        if len(row) - 1 != columns:
            problems.append(f"row `{row[0]}` has {len(row) - 1} cells, not {columns}")
        bad = [cell for cell in row[1:] if cell not in MATRIX_SYMBOLS]
        if bad:
            problems.append(f"row `{row[0]}` has invalid cells: {', '.join(bad)}")
    return problems


def _checklist_symbol(box: str, rest: str) -> str:
    if box == "x":
        return "◐" if rest.startswith("Partial:") else "✓"
    for prefix, symbol in (("N/A:", "N/A"), ("Unknown:", "?")):
        if rest.startswith(prefix):
            return symbol
    return "✗"


def checklist_values(text: str) -> dict[str, str]:
    """Read the matrix symbol each checklist item of an overview stands for.

    Args:
        text: Content of overview.md.

    Returns:
        Item name to one of the matrix symbols.
    """
    values = {}
    for line in text.splitlines():
        match = CHECKLIST_VALUE.match(line)
        if match:
            values[match["name"]] = _checklist_symbol(match["box"], match["rest"])
    return values


def matrix_overview_problems(matrix: str, overviews: dict[str, str]) -> list[str]:
    """Check that every matrix cell equals the overview item it links to.

    Args:
        matrix: Content of feature_matrix.md.
        overviews: VPN directory name to its overview.md, in matrix column order.

    Returns:
        One problem per cell that differs from its overview.
    """
    columns = [(vpn, checklist_values(text)) for vpn, text in overviews.items()]
    problems = []
    for table in feature_tables(matrix):
        for name, *cells in table.rows:
            for (vpn, values), cell in zip(columns, cells, strict=False):
                value = values.get(name, "no item")
                if value != cell:
                    problems.append(
                        f"`{name}` of {vpn}: matrix {cell}, overview {value}"
                    )
    return problems


def _render_asset(asset: str, dest: Path, values: dict[str, str]) -> None:
    text = get_analysis_asset(asset).read_text()
    for placeholder, value in values.items():
        text = text.replace(placeholder, value)
    dest.write_text(text)


def _copy_assets(ws: Path, assets: list[str]) -> None:
    for asset in assets:
        shutil.copyfile(get_analysis_asset(asset), ws / asset)


def _write_skeleton(path: Path, skeleton: VpnAnalysisJson | MatrixAnalysisJson) -> None:
    if not path.exists():
        path.write_text(json.dumps(skeleton, indent=4) + "\n")


def _build_sources(flake: str, vpn: str, out_link: Path) -> None:
    cmd = nix_command(
        [
            "build",
            "--print-out-paths",
            "--out-link",
            str(out_link),
            f"{flake}#vpnSources.{vpn}",
        ]
    )
    run(cmd, RunOpts(log=Log.STDERR))


def prepare_vpn_workspace(
    flake: str, ws: Path, vpn: str, components: list[Component]
) -> None:
    """Create or refresh the workspace an agent uses to write a VPN overview.

    Args:
        flake: Flake reference of the vpn-benchmark-suite checkout.
        ws: Workspace directory.
        vpn: VPN directory name.
        components: The components the run deployed.
    """
    ws.mkdir(parents=True, exist_ok=True)
    _render_asset(
        OVERVIEW_PROMPT,
        ws / PROMPT_MD,
        {"{{VPN}}": vpn, "{{COMPONENTS}}": components_table(components)},
    )
    _copy_assets(ws, [OVERVIEW_TEMPLATE, MATRIX_ROW_CONTRACT])
    skeleton: VpnAnalysisJson = {
        "date": None,
        "model": None,
        "revs": component_revs(components),
    }
    _write_skeleton(ws / ANALYSIS_JSON, skeleton)
    _build_sources(flake, vpn, ws / "sources")


def prepare_matrix_workspace(
    flake: str, ws: Path, run_dir: Path, components: dict[str, list[Component]]
) -> None:
    """Create or refresh the workspace an agent uses to write the feature matrix.

    Args:
        flake: Flake reference of the vpn-benchmark-suite checkout.
        ws: Workspace directory.
        run_dir: Run folder holding the imported overviews.
        components: The components of every VPN of the run.
    """
    overviews = ws / "overviews"
    sources = ws / "sources"
    overviews.mkdir(parents=True, exist_ok=True)
    sources.mkdir(parents=True, exist_ok=True)
    _render_asset(MATRIX_PROMPT, ws / PROMPT_MD, {"{{VPNS}}": vpns_table(components)})
    _copy_assets(ws, [MATRIX_ROW_CONTRACT, MATRIX_SKELETON])
    for vpn in components:
        shutil.copyfile(run_dir / vpn / OVERVIEW_MD, overviews / f"{vpn}.md")
        _build_sources(flake, vpn, sources / vpn)
    skeleton: MatrixAnalysisJson = {
        "date": None,
        "model": None,
        "revs": matrix_revs(components),
    }
    _write_skeleton(ws / ANALYSIS_JSON, skeleton)


def _describe(components: list[Component]) -> str:
    return ", ".join(f"{c.input} {c.rev}" for c in components) or "nothing"


def _pairs(components: list[Component]) -> list[tuple[str, str]]:
    return [(c.input, c.rev) for c in components]


def _vpn_workspace_problems(ws: Path, revs: dict[str, str]) -> list[str]:
    overview = ws / OVERVIEW_MD
    meta = ws / ANALYSIS_JSON
    if not overview.is_file() or not meta.is_file():
        return [f"{OVERVIEW_MD} not written yet"]
    return [
        *overview_problems(overview.read_text()),
        *analysis_json_problems(meta.read_text(), revs),
    ]


def _warn_problems(ws: Path, output: str, problems: list[str]) -> None:
    if (ws / output).exists():
        details = "".join(f"\n  - {problem}" for problem in problems)
        log.warning(f"{ws / output} is not accepted yet:{details}")


def _vpn_step(
    flake: str, data_dir: Path, vpn_dir: Path, components: list[Component]
) -> StepResult:
    vpn = vpn_dir.name
    pinned = flake_components(flake, vpn)
    if _pairs(pinned) != _pairs(components):
        msg = (
            f"the checkout pins {_describe(pinned)}, run used {_describe(components)}; "
            "check out the vpn-benchmark-suite revision of this run"
        )
        return StepResult(vpn, StepStatus.ERROR, msg)
    ws = data_dir / "analysis" / "vpn" / vpn / vpn_key(components)
    problems = _vpn_workspace_problems(ws, component_revs(components))
    if not problems:
        # Citations are checked against sources and links of the current checkout.
        _build_sources(flake, vpn, ws / "sources")
        citations, problems = citation_report(
            (ws / OVERVIEW_MD).read_text(), ws / "sources"
        )
    if not problems:
        for name in (OVERVIEW_MD, ANALYSIS_JSON):
            shutil.copyfile(ws / name, vpn_dir / name)
        (vpn_dir / CITATIONS_JSON).write_text(json.dumps(citations, indent=2) + "\n")
        return StepResult(vpn, StepStatus.IMPORTED, str(ws))
    _warn_problems(ws, OVERVIEW_MD, problems)
    prepare_vpn_workspace(flake, ws, vpn, components)
    return StepResult(vpn, StepStatus.PENDING, str(ws))


def _matrix_workspace_problems(
    ws: Path, run_dir: Path, revs: dict[str, dict[str, str]], skeleton: str
) -> list[str]:
    matrix = ws / FEATURE_MATRIX_MD
    meta = ws / ANALYSIS_JSON
    if not matrix.is_file() or not meta.is_file():
        return [f"{FEATURE_MATRIX_MD} not written yet"]
    text = matrix.read_text()
    overviews = {vpn: (run_dir / vpn / OVERVIEW_MD).read_text() for vpn in revs}
    return [
        *feature_matrix_problems(text, skeleton, len(revs)),
        *matrix_overview_problems(text, overviews),
        *analysis_json_problems(meta.read_text(), revs),
    ]


def _matrix_step(
    flake: str, data_dir: Path, run_dir: Path, components: dict[str, list[Component]]
) -> StepResult:
    revs = matrix_revs(components)
    ws = data_dir / "analysis" / "matrix" / matrix_key(revs)
    skeleton = get_analysis_asset(MATRIX_SKELETON).read_text()
    problems = _matrix_workspace_problems(ws, run_dir, revs, skeleton)
    if not problems:
        general = run_dir / GENERAL_DIR
        general.mkdir(parents=True, exist_ok=True)
        for name in (FEATURE_MATRIX_MD, ANALYSIS_JSON):
            shutil.copyfile(ws / name, general / name)
        return StepResult(MATRIX_STEP, StepStatus.IMPORTED, str(ws))
    _warn_problems(ws, FEATURE_MATRIX_MD, problems)
    prepare_matrix_workspace(flake, ws, run_dir, components)
    return StepResult(MATRIX_STEP, StepStatus.PENDING, str(ws))


def _vpn_flake() -> str:
    vpn_bench_flake = os.environ.get("VPN_BENCH_FLAKE")
    if vpn_bench_flake is None:
        msg = "Could not find VPN_BENCH_FLAKE in the environment"
        raise VpnBenchError(msg)
    return flake_ref(Path(vpn_bench_flake))


def run_components(run_dir: Path) -> dict[str, list[Component]]:
    """Read the components of every analyzable VPN of a run.

    Args:
        run_dir: Run folder `bench/<alias>`.

    Returns:
        Components per VPN directory name, sorted by name, for every VPN
        directory that has a vpn_version.json.
    """
    return {
        vpn_dir.name: load_components(vpn_dir / VPN_VERSION_JSON)
        for vpn_dir in sorted(run_dir.iterdir())
        if (vpn_dir / VPN_VERSION_JSON).is_file()
    }


def _log_summary(results: list[StepResult]) -> None:
    for status in StepStatus:
        selected = [r for r in results if r.status is status]
        if not selected:
            continue
        details = "".join(f"\n  - {r.name}: {r.detail}" for r in selected)
        if status is StepStatus.ERROR:
            log.error(f"Analysis {status.value}:{details}")
        else:
            log.info(f"Analysis {status.value}:{details}")
    if any(r.status is StepStatus.PENDING for r in results):
        log.info(
            f"Let an agent follow {PROMPT_MD} in each pending workspace, "
            "then run `vpb analyze` again to import the results"
        )


def analyze_run(config: Config, alias: str) -> None:
    """Import finished source analyses into a run, or prepare their workspaces.

    Args:
        config: Configuration whose `bench_dir` is the base bench directory.
        alias: Run folder name under `bench_dir`.

    Raises:
        VpnBenchError: If the run folder is missing, has no analyzable VPN, or
            any VPN or matrix step failed.
    """
    run_dir = config.bench_dir / alias
    if not run_dir.is_dir():
        msg = f"Run folder {run_dir} does not exist"
        raise VpnBenchError(msg)
    components = run_components(run_dir)
    if not components:
        msg = f"No VPN folder in {run_dir} has a {VPN_VERSION_JSON}"
        raise VpnBenchError(msg)
    flake = _vpn_flake()
    results = []
    for vpn, comps in components.items():
        try:
            results.append(_vpn_step(flake, config.data_dir, run_dir / vpn, comps))
        except ClanError as e:
            results.append(StepResult(vpn, StepStatus.ERROR, str(e)))
    waiting = [r.name for r in results if r.status is not StepStatus.IMPORTED]
    if waiting:
        log.info(f"Feature matrix waits for: {', '.join(waiting)}")
    else:
        try:
            results.append(_matrix_step(flake, config.data_dir, run_dir, components))
        except ClanError as e:
            results.append(StepResult(MATRIX_STEP, StepStatus.ERROR, str(e)))
    _log_summary(results)
    errors = [r for r in results if r.status is StepStatus.ERROR]
    if errors:
        msg = f"{len(errors)} analysis step(s) failed: {', '.join(r.name for r in errors)}"
        raise VpnBenchError(msg)
