{ inputs, ... }:
{
  imports = [ inputs.treefmt-nix.flakeModule ];

  perSystem =
    { pkgs, ... }:
    {
      treefmt = {
        # Used to find the project root
        projectRootFile = ".git/config";

        programs.mypy.enable = true;
        programs.nixfmt.package = pkgs.nixfmt-rfc-style;
        programs.deadnix.enable = true;
        programs.ruff.format = true;
        programs.shfmt.enable = true;
        settings.formatter.shfmt.includes = [ "*.envrc" ];
      };
    };
}
