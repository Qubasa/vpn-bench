import json
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, TypedDict

from clan_lib.api import dataclass_to_dict
from clan_lib.cmd import ClanCmdTimeoutError
from clan_lib.errors import ClanCmdError, ClanError, CmdOut


class TestMetadataDict(TypedDict, total=False):
    """Metadata about test execution.

    All fields except the core metrics are optional.
    """

    duration_seconds: float
    test_attempts: int
    vpn_restart_attempts: int
    service_logs: str  # Logs collected from target service on failure

    # Extended timing fields for bottleneck analysis
    vpn_restart_duration_seconds: float  # Time spent restarting VPN between tests
    connectivity_wait_duration_seconds: float  # Time waiting for VPN connectivity
    test_setup_duration_seconds: (
        float  # Time for test-specific setup (e.g., service restart)
    )

    # Source and target machine names for the test
    source: str  # Machine name where the test client runs
    target: str  # Machine name where the test server runs


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
    result_dir: Path,
    data: dict[str, Any] | ClanError | Exception,
    filename: str,
    metadata: TestMetadataDict | None = None,
) -> None:
    result_dir.mkdir(parents=True, exist_ok=True)
    result_file = result_dir / filename

    result: dict[str, Any] = {}
    result = dataclass_to_dict(data)
    if isinstance(data, dict):
        success_data = SucessDataClass(status="success", data=data)
        result = dataclass_to_dict(success_data)
    elif isinstance(data, ClanCmdTimeoutError):
        # Handle timeout errors specifically to include timeout value
        error_data = ErrorDataClass(status="error", error=data.cmd, error_type="CmdOut")
        result = dataclass_to_dict(error_data)
        result["timeout"] = data.timeout
    elif isinstance(data, ClanCmdError):
        error_data = ErrorDataClass(status="error", error=data.cmd, error_type="CmdOut")
        result = dataclass_to_dict(error_data)
    elif isinstance(data, ClanError):
        error_data = ErrorDataClass(
            status="error",
            error={
                "description": data.description,
                "msg": data.msg,
                "location": traceback.format_exc(),
            },
            error_type="ClanError",
        )
        result = dataclass_to_dict(error_data)
    elif isinstance(data, Exception):
        error_data = ErrorDataClass(
            status="error",
            error={
                "description": str(data),
                "msg": "Unexpected general Exception occured",
                "location": traceback.format_exc(),
            },
            error_type="ClanError",
        )
        result = dataclass_to_dict(error_data)

    # Add metadata if provided
    if metadata:
        result["meta"] = metadata

    with (result_file).open("w") as f:
        json.dump(result, f, indent=4)
