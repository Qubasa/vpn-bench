{
  self,
  ...
}:
{
  perSystem =
    
    {
      pkgs,
      config,
      self',
      inputs',
      ...
    }:
    let 
      clan-cli-module = pkgs.python3.pkgs.toPythonModule inputs'.clan-core.packages.clan-cli;
    in 
    {
      packages.vpn-bench = pkgs.callPackage ./default.nix { inherit clan-cli-module; vpn-bench-flake = self; };

      devShells.vpn-bench = pkgs.callPackage ./shell.nix {  
        inherit (self'.packages) vpn-bench; 
        # treefmt with config defined in ./flake-parts/formatting.nix
        custom_treefmt = config.treefmt.build.wrapper;
        };
    };
}
