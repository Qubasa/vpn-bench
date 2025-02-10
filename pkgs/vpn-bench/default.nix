{
  python3Packages,
  clan-cli-module,
  opentofu,
  terraform-backend-git,
  ...
}:

python3Packages.buildPythonApplication {
  name = "vpn-bench";
  src = ./.;
  format = "pyproject";

  pythonImportsCheck = [ "vpn_bench" ];

  build-system = with python3Packages; [ setuptools ];
  propagatedBuildInputs = [ 
    clan-cli-module
    opentofu
    terraform-backend-git
  ];
}
