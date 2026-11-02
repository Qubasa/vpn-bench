{
  inputs,
  ...
}:
{
  perSystem =
    {
      pkgs,
      system,
      ...
    }:

    {
      packages.easytier = pkgs.callPackage ./package.nix {
        easytier-src = inputs.easytier;
        # Cargo.toml requires Rust >= 1.95, clan-core's nixpkgs ships 1.89
        rustPlatform = pkgs.makeRustPlatform {
          inherit (inputs.toolchain-nixpkgs.legacyPackages.${system}) cargo rustc;
        };
      };
    };
}
