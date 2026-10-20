import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NotRequired, TypedDict

from clan_lib.async_run import AsyncRuntime
from clan_lib.cmd import Log, RunOpts
from clan_lib.machines.machines import Machine

from vpn_bench.cpu import (
    SNAPSHOT_FUNCTION_SH,
    CpuSnapshot,
    CpuUsageDict,
    cpu_usage,
    parse_cpu_snapshot,
    take_cpu_snapshot,
)
from vpn_bench.data import BenchMachine
from vpn_bench.remote import machine_connection, ssh_run

log = logging.getLogger(__name__)

# iperf3 --connect-timeout is in milliseconds
CONNECT_TIMEOUT_MS = "5000"
IPERF3_PORT = 5201
SS_SAMPLE_DELAY_SECONDS = 5

# Runs the iperf3 client given as "$@" after the VPN unit argument. stdout stays
# the iperf3 JSON. stderr carries a CPU snapshot before and after the run and
# one `ss` sample of the test's TCP sockets taken while data flows.
_CLIENT_SH = (
    SNAPSHOT_FUNCTION_SH
    + f"""unit=$1
shift
echo '#cpu-before' >&2
snap "$unit" >&2
"$@" &
pid=$!
for _ in $(seq {SS_SAMPLE_DELAY_SECONDS}); do
  sleep 1
  kill -0 "$pid" 2>/dev/null || break
done
echo '#ss' >&2
ss -tinH state established '( dport = :{IPERF3_PORT} )' >&2
wait "$pid"
rc=$?
echo '#cpu-after' >&2
snap "$unit" >&2
exit "$rc"
"""
)


@dataclass
class IperfCreds:
    username: str
    password: str
    pubkey: Path


class IperfCpuDict(TypedDict):
    client: CpuUsageDict
    server: CpuUsageDict


class VpbIperfDict(TypedDict):
    """Measurements vpb adds under the "vpb" key of an iperf3 result."""

    cpu: NotRequired[IperfCpuDict]
    client_data_mss: NotRequired[int]  # MSS of the client's sending data socket


@dataclass(frozen=True)
class IperfClientRun:
    result: dict[str, Any]
    cpu_before: CpuSnapshot
    cpu_after: CpuSnapshot
    data_mss: int | None


def _stderr_sections(stderr: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current: list[str] | None = None
    for line in stderr.splitlines():
        if line in ("#cpu-before", "#ss", "#cpu-after"):
            current = sections.setdefault(line[1:], [])
        elif current is not None:
            current.append(line)
    return sections


def sending_socket_mss(ss_lines: list[str]) -> int | None:
    """Return the MSS of the socket that sent the most data in an `ss -ti` sample."""
    best_acked = -1
    best_mss: int | None = None
    for line in ss_lines:
        mss = re.search(r"\bmss:(\d+)", line)
        acked = re.search(r"\bbytes_acked:(\d+)", line)
        if mss and acked and int(acked.group(1)) > best_acked:
            best_acked = int(acked.group(1))
            best_mss = int(mss.group(1))
    return best_mss


def _run_iperf_client(
    machine: Machine,
    bench_cmd: list[str],
    creds: IperfCreds,
    vpn_unit: str | None,
    timeout: int,
) -> IperfClientRun:
    res = ssh_run(
        machine_connection(machine),
        ["bash", "-c", _CLIENT_SH, "vpb-iperf", vpn_unit or "", *bench_cmd],
        RunOpts(log=Log.BOTH, timeout=timeout),
        extra_env={"IPERF3_PASSWORD": creds.password},
    )
    sections = _stderr_sections(res.stderr)
    return IperfClientRun(
        result=json.loads(res.stdout),
        cpu_before=parse_cpu_snapshot(sections.get("cpu-before", [])),
        cpu_after=parse_cpu_snapshot(sections.get("cpu-after", [])),
        data_mss=sending_socket_mss(sections.get("ss", [])),
    )


def _restart_iperf_server(target_machine: Machine) -> None:
    ssh_run(
        machine_connection(target_machine),
        ["systemctl", "restart", "iperf3.service"],
        RunOpts(log=Log.BOTH),
    )


def run_iperf_test(
    machine: Machine,
    target_host: str,
    creds: IperfCreds,
    target_machine: Machine,
    vpn_unit: str | None,
    udp_mode: bool = False,
    timeout: int = 250,
) -> dict[str, Any]:
    """Run a single iperf3 test and return the results.

    TCP runs with --bidir. UDP runs forward only (client sends, server receives):
    in UDP --bidir the server starts its data flood right after the 4-byte
    connect reply, and with netem jitter a data datagram overtaking that reply
    makes the client abort with "unable to read from stream socket".

    The iperf3 JSON gets a "vpb" entry (VpbIperfDict) with host and VPN process
    CPU on both ends and, for TCP, the MSS of the client's data socket. iperf3's
    own cpu_utilization_percent only covers the iperf3 processes, and its
    tcp_mss_default is the control socket's MSS.

    Args:
        machine: The source machine to run the test from
        target_host: The VPN hostname to connect to (e.g., "vpn.yuki")
        creds: Iperf3 credentials
        target_machine: The target Machine object for SSH access (uses public IP)
        vpn_unit: systemd unit of the VPN daemon, None for kernel or no VPN
        udp_mode: Whether to run in UDP mode
        timeout: SSH command timeout in seconds (default 250 for TCP, use 120 for UDP)
    """

    bench_cmd = [
        "iperf",
        "--connect-timeout",
        CONNECT_TIMEOUT_MS,
        "--time",
        "30",  # 30 seconds
        "--json",
        "-Z",
        "-c",
        target_host,
        "--username",
        creds.username,
        "--rsa-public-key-path",
        str(creds.pubkey),
    ]

    if udp_mode:
        bench_cmd.extend(["-u", "--udp-counters-64bit", "-b", "0"])
    else:
        bench_cmd.append("--bidir")

    _restart_iperf_server(target_machine)
    server_before = take_cpu_snapshot(target_machine, vpn_unit)
    client = _run_iperf_client(machine, bench_cmd, creds, vpn_unit, timeout)
    server_after = take_cpu_snapshot(target_machine, vpn_unit)

    vpb: VpbIperfDict = {
        "cpu": {
            "client": cpu_usage(client.cpu_before, client.cpu_after),
            "server": cpu_usage(server_before, server_after),
        }
    }
    if not udp_mode and client.data_mss is not None:
        vpb["client_data_mss"] = client.data_mss
    return {**client.result, "vpb": vpb}


def _run_single_parallel_iperf(
    source: BenchMachine,
    target: BenchMachine,
    creds: IperfCreds,
    timeout: int = 250,
    bench_time: int = 30,
) -> dict[str, Any]:
    """Run a single iperf3 TCP test from source to target.

    This is a helper for the parallel test - it restarts the server and runs the client.
    CPU is not recorded because every machine is client and server at once.

    Args:
        source: Source machine running iperf3 client
        target: Target machine running iperf3 server
        creds: Iperf3 credentials
        timeout: SSH command timeout in seconds
    """
    target_host = "vpn." + target.cmachine.name

    bench_cmd = [
        "iperf",
        "--bidir",
        "--connect-timeout",
        CONNECT_TIMEOUT_MS,
        "--time",
        str(bench_time),  # default 30 seconds
        "--json",
        "-Z",
        "-c",
        target_host,
        "--username",
        creds.username,
        "--rsa-public-key-path",
        str(creds.pubkey),
    ]

    _restart_iperf_server(target.cmachine)
    client = _run_iperf_client(source.cmachine, bench_cmd, creds, None, timeout)

    vpb: VpbIperfDict = {}
    if client.data_mss is not None:
        vpb["client_data_mss"] = client.data_mss
    return {**client.result, "vpb": vpb}


@dataclass
class ParallelIperfResult:
    """Result of a parallel iperf test for one machine pair."""

    source_name: str
    target_name: str
    result: dict[str, Any] | Exception


def run_parallel_iperf_test(
    bmachines: list[BenchMachine],
    creds: IperfCreds,
    timeout: int = 250,
) -> list[ParallelIperfResult]:
    """Run iperf3 TCP tests on all machines simultaneously.

    Each machine acts as a client connecting to the next machine in the list
    (circular pattern: A->B, B->C, C->A). All tests run in parallel.

    Args:
        bmachines: List of benchmark machines
        creds: Iperf3 credentials
        timeout: SSH command timeout in seconds

    Returns:
        List of results, one per machine pair
    """
    results: list[ParallelIperfResult] = []

    def run_test(source: BenchMachine, target: BenchMachine) -> None:
        """Run test and store result."""
        try:
            result = _run_single_parallel_iperf(
                source, target, creds, timeout, bench_time=60
            )
            results.append(
                ParallelIperfResult(
                    source_name=source.cmachine.name,
                    target_name=target.cmachine.name,
                    result=result,
                )
            )
        except Exception as e:
            log.warning(
                f"Parallel iperf test {source.cmachine.name} -> "
                f"{target.cmachine.name} failed: {e}"
            )
            results.append(
                ParallelIperfResult(
                    source_name=source.cmachine.name,
                    target_name=target.cmachine.name,
                    result=e,
                )
            )

    # Run all tests in parallel using AsyncRuntime
    with AsyncRuntime() as runtime:
        for i, source in enumerate(bmachines):
            target = bmachines[(i + 1) % len(bmachines)]
            runtime.async_run(None, run_test, source, target)
        runtime.join_all()

    return results
