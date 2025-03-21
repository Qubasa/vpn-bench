{
  config,
  ...
}:
{
  imports = [ ../shared.nix ];
  options = {

  };

  config = {
    services.qperf = {
      enable = true;
      openFirewall = true;
      serverKey = ./server.key;
      serverCrt = ./server.crt;
    };
  };
}
