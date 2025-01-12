{
  clan-cli,
  mkShell,
  python3,
  terraform,
  iperf3,
}:


let 
  clan-cli-module = python3.pkgs.toPythonModule clan-cli;
in 
mkShell { 
  buildInputs =  
  [ 
    clan-cli-module
    terraform 
    iperf3
    python3
  ];

  shellHook = ''
    export GIT_ROOT="$(git rev-parse --show-toplevel)"
    export PKG_ROOT="$GIT_ROOT"
    export PYTHONWARNINGS=error

    # Add current package to PYTHONPATH
    export PYTHONPATH="$PKG_ROOT''${PYTHONPATH:+:$PYTHONPATH:}"

    # Add clan command to PATH
    export PATH="$PKG_ROOT/bin":"$PATH"
  '';
}