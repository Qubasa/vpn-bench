{
  python3Packages,
  clan-cli-module,
  opentofu,
  vpn-bench-flake,
  ...
}:

python3Packages.buildPythonApplication {
  name = "vpn-bench";
  src = ./.;
  format = "pyproject";

  makeWrapperArgs = [
    "--set"
    "VPN_BENCH_FLAKE"
    vpn-bench-flake
  ];

  pythonImportsCheck = [ "vpn_bench" ];

  build-system = with python3Packages; [
    setuptools
  ];
  propagatedBuildInputs = [
    clan-cli-module
    opentofu
    python3Packages.textual
  ];
}
