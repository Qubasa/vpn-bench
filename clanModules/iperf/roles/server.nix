{
  config,
  ...
}:
{
  imports = [ ../shared.nix ];
  options = {
    
  };
  config = {
   services.iperf3 = {
      enable = true;
      openFirewall = true;
      port = 5201;
   };
  };
}
