import json

from vpn_bench.data import VPN, Config
from vpn_bench.errors import VpnBenchError
from vpn_bench.iperf_report import compare_vpn_reports
from vpn_bench.terraform import TrMachine


def plot_data(config: Config, tr_machines: list[TrMachine], vpn: VPN) -> None:
    reports = {}
    for tr_machine in tr_machines:
        iperf_report = config.bench_dir / tr_machine["name"] / vpn.name / "iperf3.json"
        if not iperf_report.exists():
            msg = f"Iperf3 report not found: {iperf_report}"
            raise VpnBenchError(msg)
        with iperf_report.open() as f:
            reports[f"{tr_machine['name']} -> qube.email"] = json.load(f)

    compare_vpn_reports(reports, config.bench_dir, "iperf3_report")
