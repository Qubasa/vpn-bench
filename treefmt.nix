{ inputs, ... }:
{
  imports = [ inputs.treefmt-nix.flakeModule ];

  perSystem =
    { self', pkgs, inputs', ... }:
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

        programs.prettier = {
          enable = true;
          includes = [
            "*.cjs"
            "*.css"
            "*.html"
            "*.js"
            "*.json"
            "*.json5"
            "*.jsx"
            "*.mdx"
            "*.mjs"
            "*.scss"
            "*.ts"
            "*.tsx"
            "*.vue"
            "*.yaml"
            "*.yml"
          ];
        };

        settings.global.excludes = [
          "*.png"
          "*.svg"
          "package-lock.json"
          "*.jpeg"
          "*.gitignore"
          ".vscode/*"
          "*.toml"
          "*.clan-flake"
          "*.code-workspace"
          "*.pub"
          "*.typed"
          "*.age"
          "*.list"
          "*.desktop"
          # ignore symlink
          "docs/site/manual/contribute.md"
          "*_test_cert"
          "*_test_key"
          "*/gnupg-home/*"
          "*/sops/secrets/*"
          "vars/*"
          # prettier messes up our mkdocs flavoured markdown
          "*.md"
        ];

        programs.mypy.directories =
        {
          "vpn_bench" = {
            directory = "pkgs/vpn-bench/vpn_bench";
            extraPythonPackages = [(pkgs.python3.pkgs.toPythonModule inputs'.clan-core.packages.clan-cli)] ++ self'.packages.vpn-bench.propagatedBuildInputs;
          };
          
        };

      };
    };
}
