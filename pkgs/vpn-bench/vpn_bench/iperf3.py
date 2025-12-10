import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from clan_lib.async_run import AsyncRuntime
from clan_lib.cmd import Log, RunOpts
from clan_lib.machines.machines import Machine

from vpn_bench.data import BenchMachine

log = logging.getLogger(__name__)


@dataclass
class IperfCreds:
    username: str
    password: str
    pubkey: Path


def run_iperf_test(
    machine: Machine,
    target_host: str,
    creds: IperfCreds,
    target_machine: Machine,
    udp_mode: bool = False,
    timeout: int = 250,
) -> dict[str, Any]:
    """Run a single iperf3 test and return the results.

    Args:
        machine: The source machine to run the test from
        target_host: The VPN hostname to connect to (e.g., "vpn.yuki")
        creds: Iperf3 credentials
        udp_mode: Whether to run in UDP mode
        target_machine: The target Machine object for SSH access (uses public IP)
        timeout: SSH command timeout in seconds (default 250 for TCP, use 120 for UDP)
    """

    bench_cmd = [
        "iperf",
        "--bidir",
        "--connect-timeout",
        "600",  # 5 seconds
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

    # Restart iperf3 service on target (server) before running the test
    if target_machine:
        # Use the target machine's public IP for SSH
        target = target_machine.target_host().override(host_key_check="none")
    with target.host_connection() as ssh:
        ssh.run(
            ["systemctl", "restart", "iperf3.service"],
            RunOpts(log=Log.BOTH),
        )

    # Run iperf3 client on source machine
    host = machine.target_host().override(host_key_check="none")
    with host.host_connection() as ssh:
        # Set the password for the iperf3 server
        res = ssh.run(
            bench_cmd,
            RunOpts(log=Log.BOTH, timeout=timeout),
            extra_env={"IPERF3_PASSWORD": creds.password},
        )

    return json.loads(res.stdout)


def _run_single_parallel_iperf(
    source: BenchMachine,
    target: BenchMachine,
    creds: IperfCreds,
    timeout: int = 250,
    bench_time: int = 30,
) -> dict[str, Any]:
    """Run a single iperf3 TCP test from source to target.

    This is a helper for the parallel test - it restarts the server and runs the client.

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
        "600",  # 5 minutes
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

    # Restart iperf3 service on target (server) before running the test
    target_ssh_host = target.cmachine.target_host().override(host_key_check="none")
    with target_ssh_host.host_connection() as ssh:
        ssh.run(
            ["systemctl", "restart", "iperf3.service"],
            RunOpts(log=Log.BOTH),
        )

    # Run iperf3 client on source machine
    source_ssh_host = source.cmachine.target_host().override(host_key_check="none")
    with source_ssh_host.host_connection() as ssh:
        res = ssh.run(
            bench_cmd,
            RunOpts(log=Log.BOTH, timeout=timeout),
            extra_env={"IPERF3_PASSWORD": creds.password},
        )

    return json.loads(res.stdout)


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
