{ ... }:
let
  module = ./default.nix;
in
{
  clan.modules = {
    mycelium = module;
  };
}
