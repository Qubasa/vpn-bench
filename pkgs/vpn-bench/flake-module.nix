{
  ...
}:
{
  perSystem =
    
    {
      pkgs,
      inputs',
      ...
    }:
    let 
      clan-cli-module = pkgs.python3.pkgs.toPythonModule inputs'.clan-core.packages.clan-cli;
    in 
    {
      packages.default = pkgs.callPackage ./default.nix { inherit clan-cli-module; };
    };
}
