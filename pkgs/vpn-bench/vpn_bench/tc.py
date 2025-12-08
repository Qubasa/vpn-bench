"""Traffic Control (tc) utilities for simulating network conditions."""

import concurrent
import logging
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager

from clan_lib.cmd import Log, RunOpts
from clan_lib.machines.machines import Machine

from vpn_bench.data import TCSettings

log = logging.getLogger(__name__)


def _apply_tc_to_machine(machine: Machine, settings: TCSettings) -> None:
    """Apply TC settings to a single machine."""
    host = machine.target_host().override(host_key_check="none")

    with host.host_connection() as ssh:
        # Find the primary network interface (excluding loopback)
        result = ssh.run(
            ["ip", "route", "show", "default"],
            RunOpts(log=Log.BOTH),
        )
        # Extract interface name from output like: "default via 10.0.0.1 dev eth0 ..."
        interface = "eth0"  # Default fallback
        if result.stdout:
            parts = result.stdout.strip().split()
            if "dev" in parts:
                dev_idx = parts.index("dev")
                if dev_idx + 1 < len(parts):
                    interface = parts[dev_idx + 1]

        log.info(f"Applying TC settings to {machine.name} on interface {interface}")

        # Clear any existing tc rules first
        ssh.run(
            ["tc", "qdisc", "del", "dev", interface, "root"],
            RunOpts(log=Log.BOTH, check=False),  # Don't fail if no qdisc exists
        )

        # Build tc netem command
        tc_cmd = ["tc", "qdisc", "add", "dev", interface, "root", "netem"]

        if settings.latency_ms is not None:
            tc_cmd.extend(["delay", f"{settings.latency_ms}ms"])

            # Add jitter if specified
            if settings.jitter_ms is not None:
                tc_cmd.append(f"{settings.jitter_ms}ms")

        if settings.packet_loss_percent is not None:
            tc_cmd.extend(["loss", f"{settings.packet_loss_percent}%"])

        if settings.reorder_percent is not None:
            tc_cmd.extend(["reorder", f"{settings.reorder_percent}%"])
            # Add correlation if specified
            if settings.reorder_correlation is not None:
                tc_cmd.append(f"{settings.reorder_correlation}%")

        # Apply netem settings if any were specified
        if len(tc_cmd) > 7:  # More than just the base command
            ssh.run(tc_cmd, RunOpts(log=Log.BOTH))

        # Apply bandwidth limit if specified (requires tbf qdisc)
        if settings.bandwidth_mbit is not None:
            # If we applied netem, we need to use a parent qdisc
            if len(tc_cmd) > 7:
                # Add tbf as a child qdisc
                bandwidth_bps = settings.bandwidth_mbit * 1_000_000
                burst = max(
                    bandwidth_bps // 8, 1500
                )  # Burst size in bytes, at least MTU
                ssh.run(
                    [
                        "tc",
                        "qdisc",
                        "add",
                        "dev",
                        interface,
                        "parent",
                        "1:1",
                        "handle",
                        "10:",
                        "tbf",
                        "rate",
                        f"{settings.bandwidth_mbit}mbit",
                        "burst",
                        str(burst),
                        "latency",
                        "50ms",
                    ],
                    RunOpts(log=Log.BOTH),
                )
            else:
                # Use tbf directly as root qdisc
                bandwidth_bps = settings.bandwidth_mbit * 1_000_000
                burst = max(bandwidth_bps // 8, 1500)
                ssh.run(
                    [
                        "tc",
                        "qdisc",
                        "add",
                        "dev",
                        interface,
                        "root",
                        "tbf",
                        "rate",
                        f"{settings.bandwidth_mbit}mbit",
                        "burst",
                        str(burst),
                        "latency",
                        "50ms",
                    ],
                    RunOpts(log=Log.BOTH),
                )

        # Verify settings were applied
        result = ssh.run(
            ["tc", "qdisc", "show", "dev", interface],
            RunOpts(log=Log.BOTH),
        )
        log.debug(f"TC settings on {machine.name}: {result.stdout}")


def _clear_tc_from_machine(machine: Machine) -> None:
    """Clear TC settings from a single machine."""
    host = machine.target_host().override(host_key_check="none")

    with host.host_connection() as ssh:
        # Find the primary network interface
        result = ssh.run(
            ["ip", "route", "show", "default"],
            RunOpts(log=Log.BOTH),
        )
        interface = "eth0"
        if result.stdout:
            parts = result.stdout.strip().split()
            if "dev" in parts:
                dev_idx = parts.index("dev")
                if dev_idx + 1 < len(parts):
                    interface = parts[dev_idx + 1]

        log.info(f"Clearing TC settings from {machine.name} on interface {interface}")

        # Remove all tc rules
        ssh.run(
            ["tc", "qdisc", "del", "dev", interface, "root"],
            RunOpts(log=Log.BOTH, check=False),  # Don't fail if no qdisc exists
        )


def _apply_tc_settings_internal(machines: list[Machine], settings: TCSettings) -> None:
    """
    Apply traffic control settings to all machines in parallel (internal helper).

    Args:
        machines: List of machines to apply settings to
        settings: TC settings to apply
    """
    log.info(f"Applying TC settings to {len(machines)} machines: {settings}")

    with ThreadPoolExecutor() as executor:
        futures = []
        for machine in machines:
            future = executor.submit(_apply_tc_to_machine, machine, settings)
            futures.append(future)

        done, _not_done = concurrent.futures.wait(futures)

        for future in done:
            exc = future.exception()
            if exc is not None:
                log.error(f"Failed to apply TC settings: {exc}")
                raise exc


def clear_tc_settings(machines: list[Machine]) -> None:
    """
    Clear traffic control settings from all machines in parallel.

    Args:
        machines: List of machines to clear settings from
    """
    log.info(f"Clearing TC settings from {len(machines)} machines")

    with ThreadPoolExecutor() as executor:
        futures = []
        for machine in machines:
            future = executor.submit(_clear_tc_from_machine, machine)
            futures.append(future)

        done, _not_done = concurrent.futures.wait(futures)

        for future in done:
            exc = future.exception()
            if exc is not None:
                log.error(f"Failed to clear TC settings: {exc}")
                raise exc


@contextmanager
def apply_tc_settings(
    machines: list[Machine], settings: TCSettings | None
) -> Generator[None]:
    """
    Context manager to apply TC settings and automatically clear them on exit.

    Args:
        machines: List of machines to apply settings to
        settings: TC settings to apply (None for baseline - just clears any existing settings)

    Yields:
        None

    Usage:
        with apply_tc_settings(machines, settings):
            # Run benchmarks with TC settings applied
            run_benchmarks(...)
        # TC settings automatically cleared here
    """
    try:
        if settings is not None:
            # Apply the TC settings
            _apply_tc_settings_internal(machines, settings)
        else:
            # For baseline, just ensure TC settings are cleared
            clear_tc_settings(machines)

        yield  # Control returns to the with block

    finally:
        # Always clear TC settings on exit, even if an exception occurred
        clear_tc_settings(machines)
