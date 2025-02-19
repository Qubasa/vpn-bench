{ mkShell, mypy, ruff, vpn-bench, custom_treefmt,... }:
mkShell { 
  buildInputs =  
    [ 
      mypy
      ruff
      custom_treefmt
    ] ++ vpn-bench.propagatedBuildInputs;

  shellHook = ''
    export GIT_ROOT="$(git rev-parse --show-toplevel)"
    export PKG_ROOT="$GIT_ROOT/pkgs/vpn-bench"
    export PYTHONWARNINGS=error

    # Add current package to PYTHONPATH
    export PYTHONPATH="$PKG_ROOT''${PYTHONPATH:+:$PYTHONPATH:}"

    # Add bin folder to PATH
    export PATH="$PKG_ROOT/bin":"$PATH"

    export VPN_BENCH_FLAKE="$GIT_ROOT"

    if [ -f .local.env ]; then
      source .local.env
    fi
  '';
}