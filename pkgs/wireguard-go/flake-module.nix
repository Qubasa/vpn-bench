{
  inputs,
  ...
}:
{
  perSystem =
    {
      pkgs,
      ...
    }:

    {
      packages.wireguard-go = pkgs.callPackage ./package.nix {
        wireguard-go-src = inputs.wireguard-go;
      };
    };
}
