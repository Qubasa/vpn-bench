#!/usr/bin/env python3

import os
import json
import time
import datetime
import urllib.request
import concurrent.futures
import urllib.error
import ipaddress
from typing import Any, Dict, Optional
from pathlib import Path

import logging

log = logging.getLogger(__name__)


def is_ipv6(ip: str) -> bool:
    try:
        return isinstance(ipaddress.ip_address(ip), ipaddress.IPv6Address)
    except ValueError:
        return False


def check_ip(
    ip: str,
    started: datetime.datetime,
    ip_type: str,
    expected_response: Optional[str] = None,
    timeout: int = 1,
    max_retries: int = 300,
    retry_delay: float = 1.0,
) -> Dict[str, Any]:
    """
    Check if an IP address is reachable and returns the expected response.

    Args:
        ip: The IP address to check
        started: When the check process started
        ip_type: Type of IP ("public" or "vpn")
        expected_response: Expected response (for public IPs)
        timeout: Connection timeout in seconds
        max_retries: Maximum number of retry attempts
        retry_delay: Delay between retries in seconds

    Returns:
        Dictionary with check results
    """
    for attempt in range(1, max_retries + 1):
        try:
            if is_ipv6(ip):
                url = f"http://[{ip}]/name"
            else:
                url = f"http://{ip}/name"

            with urllib.request.urlopen(url, timeout=timeout) as resp:
                body = resp.read().decode().strip()
                ended = datetime.datetime.now(datetime.UTC)

                # For public IPs, verify the response matches expected
                if expected_response is not None and body != expected_response:
                    log.error(
                        f"{ip_type} {ip} response mismatch. Expected: {expected_response}, Got: {body}"
                    )
                    if attempt < max_retries:
                        time.sleep(retry_delay)
                        continue
                    return {
                        "response": f"Response mismatch. Expected: {expected_response}, Got: {body}",
                        "ended": ended.isoformat(),
                        "time_took": str(ended - started),
                        "attempt": attempt,
                        "status": "failed",
                    }

                log.info(f"{ip_type} {ip} => {body} at {ended} (attempt {attempt})")
                return {
                    "response": body,
                    "ended": ended.isoformat(),
                    "time_took": str(ended - started),
                    "attempt": attempt,
                    "status": "success",
                }
        except Exception as e:
            log.error(f"{ip_type} {ip} attempt {attempt} => {e}")
            if attempt < max_retries:
                time.sleep(retry_delay)
            else:
                ended = datetime.datetime.now(datetime.UTC)
                return {
                    "response": str(e),
                    "ended": ended.isoformat(),
                    "time_took": str(ended - started),
                    "attempt": attempt,
                    "status": "failed",
                }

    # This should never be reached with the current logic, but added for completeness
    ended = datetime.datetime.now(datetime.UTC)
    return {
        "response": "Maximum retries exceeded",
        "ended": ended.isoformat(),
        "time_took": str(ended - started),
        "attempt": max_retries,
        "status": "failed",
    }


def main() -> None:
    log.info("Connection check")

    vpn_ips: dict[str, str] = {}
    if vpn_ips_str := os.environ.get("VPN_IPS"):
        vpn_ips = json.loads(vpn_ips_str)
        log.info("VPN IPs: %s", vpn_ips)
    else:
        raise RuntimeError("VPN_IPS not found in the environment")

    if len(vpn_ips.keys()) == 0:
        log.warning("No VPN IPs to check")

    public_ips: dict[str, str] = {}
    if public_ips_str := os.environ.get("PUBLIC_IPS"):
        public_ips = json.loads(public_ips_str)
        log.info("Public IPs: %s", public_ips)
    else:
        raise RuntimeError("PUBLIC_IPS not found in the environment")

    if len(public_ips.keys()) == 0:
        log.warning("No public IPs to check")

    started = datetime.datetime.now(datetime.UTC)
    log.info(f"Started at {started.isoformat()}")

    # Prepare results dictionaries
    public_results: dict[str, Any] = {}
    vpn_results: dict[str, Any] = {}

    # Define functions to run in threads
    def check_public_ip(ip: str) -> None:
        public_results[ip] = check_ip(
            ip=ip,
            started=started,
            ip_type="Public",
            expected_response=public_ips[ip],
            timeout=1,
            max_retries=300,  # 5 minutes with 1 second delay
            retry_delay=1.0,
        )

    def check_vpn_ip(ip: str) -> None:
        vpn_results[ip] = check_ip(
            ip=ip,
            started=started,
            ip_type="VPN",
            timeout=1,  # Increased from 1 to be consistent with public IP checks
            max_retries=300,  # 5 minutes with 1 second delay
            retry_delay=1.0,
        )

    # Check public IPs
    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = {executor.submit(check_public_ip, ip): ip for ip in public_ips.keys()}
        concurrent.futures.wait(futures)

    # Check if any public IP checks failed
    failures = [
        ip for ip, result in public_results.items() if result["status"] == "failed"
    ]
    if failures:
        log.error(f"Failed to contact public IPs: {failures}")
        raise RuntimeError(f"Failed to contact nginx servers: {failures}")

    # Check VPN IPs
    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = {executor.submit(check_vpn_ip, ip): ip for ip in vpn_ips.keys()}
        concurrent.futures.wait(futures)

    result_file = Path.cwd() / "connection_timings.json"

    report = {
        "started": started.isoformat(),
        "public_ips": public_ips,
        "public_results": public_results,
        "vpn_ips": vpn_ips,
        "vpn_results": vpn_results,
    }
    with result_file.open("w") as f:
        json.dump(report, f, indent=4)

    log.info(f"Public results: {json.dumps(public_results, indent=4)}")
    log.info(f"VPN results: {json.dumps(vpn_results, indent=4)}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    main()
