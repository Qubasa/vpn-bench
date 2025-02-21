#!/usr/bin/env python3

import json
import statistics
import sys

from clan_cli.cmd import run
from clan_cli.nix import nix_shell


def run_bandwidth_test(server: str, port: int) -> float | None:
    try:
        # Use 'nix_shell' to run 'iperf3' within a Nix shell environment
        cmd: list[str] = nix_shell(
            ["nixpkgs#iperf3"], ["iperf3", "-c", server, "-p", str(port), "-J"]
        )
        result = run(cmd)
        if result.returncode == 0:
            output = json.loads(result.stdout)
            bandwidth: float = output["end"]["sum_received"]["bits_per_second"]
            bandwidth_mbps: float = bandwidth / 1e6  # Convert to Mbps
            return bandwidth_mbps
        print(f"iperf3 test to {server} failed:", result.stderr)
    except Exception as e:
        print(f"Error running iperf3 test to {server}:", e)
        return None
    else:
        return None


def detect_noisy_neighbor(threshold_mbps: float = 900) -> bool:
    # List of public iperf3 servers
    servers: list[tuple[str, int]] = [
        ("qube.email", 5201),
        # ("iperf.he.net", 5201),
        # ("iperf3.moji.fr", 5201),
    ]

    bandwidth_results: list[float] = []

    # Run tests against each server
    for server, port in servers:
        print(f"Testing bandwidth to {server}...")
        bandwidth = run_bandwidth_test(server, port)
        if bandwidth is not None:
            print(f"Bandwidth to {server}: {bandwidth:.2f} Mbps")
            bandwidth_results.append(bandwidth)
        else:
            print(f"Failed to get bandwidth to {server}")

    if not bandwidth_results:
        print("No successful bandwidth tests were performed.")
        return True  # Assume noisy neighbor if no tests succeeded

    # Calculate average bandwidth
    average_bandwidth: float = statistics.mean(bandwidth_results)
    print(f"Average bandwidth: {average_bandwidth:.2f} Mbps")

    # Check if average bandwidth is below threshold
    if average_bandwidth < threshold_mbps:
        print("Average bandwidth is below threshold.")
        return True  # Noisy neighbor detected
    print("Average bandwidth is above threshold.")
    return False  # No noisy neighbor detected


if __name__ == "__main__":
    noisy_neighbor_detected: bool = detect_noisy_neighbor()
    if noisy_neighbor_detected:
        print("Noisy neighbor detected. Consider redeploying.")
        sys.exit(1)
    else:
        print("No noisy neighbor detected.")
        sys.exit(0)
