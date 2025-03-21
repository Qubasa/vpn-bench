{
  ...
}:
{
  imports = [ ../shared.nix ];
  options = {

  };

  config = {
    services.nperf = {
      enable = true;
      openFirewall = true;
      serverKey = ./server.key;
      serverCrt = ./server.crt;
    };
  };
}
