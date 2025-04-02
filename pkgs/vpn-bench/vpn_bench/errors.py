import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from clan_cli.api import dataclass_to_dict
from clan_cli.errors import ClanError, CmdOut


class VpnBenchError(ClanError):
    pass


@dataclass
class SucessDataClass:
    status: Literal["success"]
    data: dict[str, Any]


@dataclass
class ErrorDataClass:
    status: Literal["error"]
    error: CmdOut


def save_bench_report(
    result_dir: Path, data: dict[str, Any] | ClanError, filename: str
) -> None:
    result_dir.mkdir(parents=True, exist_ok=True)
    result_file = result_dir / filename

    result: dict[str, Any] = {}
    result = dataclass_to_dict(data)
    # if isinstance(data, dict):
    #     success_data = SucessDataClass(status="success", data=data)
    #     result = dataclass_to_dict(success_data)
    # elif isinstance(data, ClanCmdError):
    #     error_data = ErrorDataClass(status="error", error=data.cmd)
    #     result = dataclass_to_dict(error_data)
    # elif isinstance(data, ClanError):
    #     raise data

    with (result_file).open("w") as f:
        json.dump(result, f, indent=4)
