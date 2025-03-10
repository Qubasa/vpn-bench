#!/usr/bin/env python3

import os
import json
import time
import datetime
import urllib.request
import concurrent.futures
import urllib.error
import ipaddress
from typing import Any
from pathlib import Path
from contextlib import contextmanager
from typing import Generator

import logging

log = logging.getLogger(__name__)


def is_ipv6(ip: str) -> bool:
    try:
        return isinstance(ipaddress.ip_address(ip), ipaddress.IPv6Address)
    except ValueError:
        return False


def main() -> None:
    log.info("Connection check")

    vpn_ips: dict[str, str] = {}
    if vpn_ips_str := os.environ.get("VPN_IPS"):
        vpn_ips = json.loads(vpn_ips_str)
        log.info("VPN IPs:", vpn_ips)
    else:
        raise RuntimeError("VPN_IPS not found in the environment")

    if len(vpn_ips.keys()) == 0:
        log.warning("No VPN IPs to check")

    public_ips: dict[str, str] = {}
    if public_ips_str := os.environ.get("PUBLIC_IPS"):
        public_ips = json.loads(public_ips_str)
        log.info("Public IPs:", public_ips)
    else:
        raise RuntimeError("PUBLIC_IPS not found in the environment")

    if len(public_ips.keys()) == 0:
        log.warning("No public IPs to check")

    # Check if we can reach over the clearnet the nginx servers
    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = {
            executor.submit(urllib.request.urlopen, f"http://{ip}/name", timeout=15): ip
            for ip in public_ips.keys()
        }
        concurrent.futures.wait(futures)
        for future in concurrent.futures.as_completed(futures):
            if future.exception() is not None:
                raise RuntimeError(
                    "Failed to contact nginx server"
                ) from future.exception()
            ip = futures[future]
            expected_resp = public_ips[ip]
            resp = future.result()
            body = resp.read().decode().strip()
            assert body == expected_resp, (
                f"Expected {expected_resp}, got {body.strip()}"
            )
            log.info(f"{ip} => {body}")

    vpn_results: dict[str, Any] = {}

    def check_vpn(ip: str) -> None:
        max_retries = 600
        for attempt in range(1, max_retries + 1):
            try:
                if is_ipv6(ip):
                    url = f"http://[{ip}]/name"
                else:
                    url = f"http://{ip}/name"

                with urllib.request.urlopen(url, timeout=1) as resp:
                    body = resp.read().decode().strip()
                    ended = datetime.datetime.now(datetime.UTC)
                    vpn_results[ip] = {
                        "response": body,
                        "ended": ended.isoformat(),
                        "time_took": str(ended - started),
                        "attempt": attempt,
                        "status": "success",
                    }
                    log.info(f"{ip} => {body} at {ended}")
                    break
            except Exception as e:
                log.error(f"{ip} attempt {attempt} => {e}")
                if attempt < max_retries:
                    time.sleep(0.5)
                else:
                    msg = f"Contacting {vpn_ips[ip]} over VPN with IP {ip} failed after {max_retries * 1.5 / 60} minutes"
                    ended = datetime.datetime.now(datetime.UTC)
                    vpn_results[ip] = {
                        "response": str(e),
                        "ended": ended.isoformat(),
                        "time_took": str(ended - started),
                        "attempt": attempt,
                        "status": "failed",
                    }
                    log.info(msg)

    started = datetime.datetime.now(datetime.UTC)
    log.info(f"Started at {started.isoformat()}")
    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = {executor.submit(check_vpn, ip): ip for ip in vpn_ips.keys()}
        concurrent.futures.wait(futures)

    result_file = Path.cwd() / "connection_timings.json"

    report = {
        "started": started.isoformat(),
        "public_ips": public_ips,
        "vpn_ips": vpn_ips,
        "vpn_results": vpn_results,
    }
    with result_file.open("w") as f:
        json.dump(report, f, indent=4)

    log.info(f"VPN results: {json.dumps(vpn_results, indent=4)}")


@contextmanager
def running_file() -> Generator[None, None, None]:
    file = Path.cwd() / "running"
    file.touch()
    yield
    file.unlink()


if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    with running_file():
        main()
