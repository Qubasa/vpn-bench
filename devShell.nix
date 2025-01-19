{ ... }:
{
  perSystem =
    {
      pkgs,
      inputs',
      config,
      ...
    }:

let 
  clan-cli-module = pkgs.python3.pkgs.toPythonModule inputs'.clan-core.packages.clan-cli;
in 
{

 devShells.default = pkgs.mkShell { 
  buildInputs =  
  with pkgs; [ 
    clan-cli-module
    mypy
    ruff
    opentofu 
    # treefmt with config defined in ./flake-parts/formatting.nix
    config.treefmt.build.wrapper
    python3
    treefmt
  ];

  shellHook = ''
    export GIT_ROOT="$(git rev-parse --show-toplevel)"
    export PKG_ROOT="$GIT_ROOT"
    export PYTHONWARNINGS=error

    # Add current package to PYTHONPATH
    export PYTHONPATH="$PKG_ROOT''${PYTHONPATH:+:$PYTHONPATH:}"

    # Add clan command to PATH
    export PATH="$PKG_ROOT/bin":"$PATH"

    if [ -f .local.env ]; then
      source .local.env
    fi
  '';
 };
};
}