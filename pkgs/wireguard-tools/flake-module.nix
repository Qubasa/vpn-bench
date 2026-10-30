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
      packages.wireguard-tools = pkgs.callPackage ./package.nix {
        wireguard-tools-src = inputs.wireguard-tools;
      };
    };
}
