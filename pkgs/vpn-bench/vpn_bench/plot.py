import logging
import os
import threading
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any

from clan_cli.cmd import run
from clan_cli.nix import nix_build, nix_config

from vpn_bench.connection_timings import analyse_connection_timings
from vpn_bench.data import Config
from vpn_bench.errors import VpnBenchError
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)


def plot_data(config: Config, tr_machines: list[TrMachine]) -> None:
    vpn_bench_flake = os.environ.get("VPN_BENCH_FLAKE")

    analyse_connection_timings(config, tr_machines)

    log.info("Building webview-ui for plotting the data")
    nix_conf = nix_config()
    build_script = f"""
    let
        self = builtins.getFlake "{vpn_bench_flake}";
        lib = self.inputs.nixpkgs.lib;
    in
        self.packages.{nix_conf["system"]}.webview-ui.override {{ benchDir = {config.bench_dir}; }}
    """

    cmd = nix_build(
        ["--log-format", "bar-with-logs", "--impure", "--expr", build_script]
    )
    out = run(cmd)

    website_dir = Path(out.stdout.strip()) / "lib/node_modules/@clan/webview-ui/dist"

    log.info(f"Website dir: {website_dir}")

    if not website_dir.exists():
        msg = f"Webview UI not found at {website_dir}"
        raise VpnBenchError(msg)

    class CustomHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, directory=str(website_dir), **kwargs)

        def translate_path(self, web_path: str) -> str:
            if web_path.startswith("/assets"):
                return super().translate_path(web_path)
            return str(website_dir / "index.html")

        def end_headers(self) -> None:
            # Add CORS headers to allow loading from any origin
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            # Add no-cache headers
            self.send_header(
                "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"
            )
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            super().end_headers()

    class ServerWithBrowserOpener(HTTPServer):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.browser_opened = False
            super().__init__(*args, **kwargs)

        def serve_forever(self, poll_interval: float = 0.5) -> None:
            # Open browser after server starts listening
            def open_browser() -> None:
                url = "http://localhost:8000"
                log.info(f"Opening browser at: {url}")
                webbrowser.open_new_tab(url)
                self.browser_opened = True

            # Schedule the browser opening after a short delay to ensure server is ready
            if not self.browser_opened:
                threading.Timer(1.0, open_browser).start()

            # Continue with normal server operation
            super().serve_forever(poll_interval)

    server_address = ("localhost", 8000)
    httpd = ServerWithBrowserOpener(server_address, CustomHandler)
    log.info("Report is being served on: http://localhost:8000")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down the server")
    finally:
        httpd.server_close()
