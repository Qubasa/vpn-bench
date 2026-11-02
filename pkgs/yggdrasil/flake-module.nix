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
      packages.yggdrasil = pkgs.callPackage ./package.nix {
        yggdrasil-src = inputs.yggdrasil;
        # go.mod requires Go >= 1.26.0, clan-core's nixpkgs ships 1.25
        buildGoModule = pkgs.buildGoModule.override {
          go = inputs.toolchain-nixpkgs.legacyPackages.${system}.go_1_27;
        };
      };
    };
}
