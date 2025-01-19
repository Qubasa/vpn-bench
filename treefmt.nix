{ inputs, ... }:
{
  imports = [ inputs.treefmt-nix.flakeModule ];

  perSystem =
    { pkgs, inputs', ... }:
    {
      treefmt = {
        # Used to find the project root
        projectRootFile = ".git/config";

        programs.mypy.enable = true;
        programs.nixfmt.package = pkgs.nixfmt-rfc-style;
        programs.deadnix.enable = true;
        programs.ruff.check = true;
        programs.ruff.format = true;
        programs.shfmt.enable = true;
        settings.formatter.shfmt.includes = [ "*.envrc" ];

        programs.mypy.directories =
        {
          "vpn_bench" = {
            directory = "vpn_bench";
            extraPythonPackages = [(pkgs.python3.pkgs.toPythonModule inputs'.clan-core.packages.clan-cli)];
          };
          
        };

      };
    };
}
