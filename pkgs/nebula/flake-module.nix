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
      packages.nebula = pkgs.callPackage ./package.nix {
        nebula-src = inputs.nebula;
        # go.mod requires Go >= 1.27.3, clan-core's nixpkgs ships 1.25
        buildGoModule = pkgs.buildGoModule.override {
          go = inputs.toolchain-nixpkgs.legacyPackages.${system}.go_1_27;
        };
      };
    };
}
