import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, TypedDict

from clan_cli.api import dataclass_to_dict
from clan_cli.errors import ClanCmdError, ClanError, CmdOut


class VpnBenchError(ClanError):
    pass


@dataclass
class SucessDataClass:
    status: Literal["success"]
    data: dict[str, Any]


class ClanErrorType(TypedDict):
    description: str | None
    location: str
    msg: str


@dataclass
class ErrorDataClass:
    status: Literal["error"]
    error_type: Literal["CmdOut", "ClanError"]
    error: CmdOut | ClanErrorType


def save_bench_report(
    result_dir: Path, data: dict[str, Any] | ClanError, filename: str
) -> None:
    result_dir.mkdir(parents=True, exist_ok=True)
    result_file = result_dir / filename

    result: dict[str, Any] = {}
    result = dataclass_to_dict(data)
    if isinstance(data, dict):
        success_data = SucessDataClass(status="success", data=data)
        result = dataclass_to_dict(success_data)
    elif isinstance(data, ClanCmdError):
        error_data = ErrorDataClass(status="error", error=data.cmd, error_type="CmdOut")
        result = dataclass_to_dict(error_data)
    elif isinstance(data, ClanError):
        error_data = ErrorDataClass(
            status="error",
            error={
                "description": data.description,
                "msg": data.msg,
                "location": data.location,
            },
            error_type="ClanError",
        )
        result = dataclass_to_dict(error_data)

    with (result_file).open("w") as f:
        json.dump(result, f, indent=4)
