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
      packages.headscale = pkgs.callPackage ./package.nix {
        headscale-src = inputs.headscale;
        # go.mod requires Go >= 1.27.3, clan-core's nixpkgs ships 1.25
        buildGoModule = pkgs.buildGoModule.override {
          go = inputs.toolchain-nixpkgs.legacyPackages.${system}.go_1_27;
        };
      };
    };
}
