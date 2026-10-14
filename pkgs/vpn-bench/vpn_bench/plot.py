import logging
import os
import threading
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any

from clan_lib.cmd import run
from clan_lib.nix import nix_build, nix_config

from vpn_bench.connection_timings import analyse_connection_timings
from vpn_bench.data import Config
from vpn_bench.errors import VpnBenchError
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)


def flake_ref(flake_dir: Path) -> str:
    """Return the flake reference Nix's CLI would pick for a local directory.

    `builtins.getFlake` turns a bare path into a `path:` input, which copies
    the whole tree including `.git` and fails on sockets such as git's
    `fsmonitor--daemon.ipc`. The CLI uses `git+file:` for git checkouts instead.
    """
    if (flake_dir / ".git").exists():
        return f"git+file://{flake_dir}"
    return f"path:{flake_dir}"


def build_ui(bench_dir: Path, create_symlink: bool = False) -> Path:
    """Build the webview-ui for plotting benchmark data.

    Args:
        bench_dir: Path to the benchmark directory containing the data.
        create_symlink: If True, create a 'result' symlink in the current directory.

    Returns:
        Path to the built website directory.
    """
    vpn_bench_flake = os.environ.get("VPN_BENCH_FLAKE")
    if vpn_bench_flake is None:
        msg = "Could not find VPN_BENCH_FLAKE in the environment"
        raise VpnBenchError(msg)

    log.info("Building webview-ui for plotting the data")
    nix_conf = nix_config()
    build_script = f"""
    let
        self = builtins.getFlake "{flake_ref(Path(vpn_bench_flake))}";
        lib = self.inputs.nixpkgs.lib;
    in
        self.packages.{nix_conf["system"]}.webview-ui.override {{ benchDir = {bench_dir}; }}
    """

    cmd = nix_build(
        ["--log-format", "bar-with-logs", "--impure", "--expr", build_script]
    )
    out = run(cmd)

    store_path = Path(out.stdout.strip())
    website_dir = store_path / "lib/node_modules/@clan/webview-ui/dist"

    log.info(f"Website dir: {website_dir}")

    if not website_dir.exists():
        msg = f"Webview UI not found at {website_dir}"
        raise VpnBenchError(msg)

    if create_symlink:
        symlink_path = Path.cwd() / "result"
        if symlink_path.is_symlink():
            symlink_path.unlink()
        elif symlink_path.exists():
            msg = f"Cannot create symlink: {symlink_path} already exists and is not a symlink"
            raise VpnBenchError(msg)
        symlink_path.symlink_to(store_path)
        log.info(f"Created symlink: {symlink_path} -> {store_path}")

    return website_dir


def plot_data(config: Config, tr_machines: list[TrMachine]) -> None:
    analyse_connection_timings(config)

    website_dir = build_ui(config.bench_dir)

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
