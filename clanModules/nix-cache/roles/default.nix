{
  config,
  clan-core,
  pkgs,
  ...
}:
{
  options.clan.nix-cache = {

  };

  imports = [
    clan-core.clanModules.nginx
  ];


  config = {
    services.harmonia.enable = true;
   
    environment.systemPackages = with pkgs; [
      hyperfine
    ];

    assertions = [
      {
        assertion = (config.clan ? my-static-hosts) == true;
        message = "The nix-cache module requires the my-static-hosts module to be configured with the hostnames.";
      }
    ];

    services.nginx = 
    let 
      hostName = config.networking.hostName;
    in  {
    
      virtualHosts."cache.vpn.${hostName}" = {
        serverAliases = [ "cache.v4.${hostName}" "cache.v6.${hostName}" ];
        locations."/".extraConfig = ''
          proxy_pass http://127.0.0.1:5000;
          proxy_set_header Host $host;
          proxy_redirect http:// https://;
          proxy_http_version 1.1;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection $connection_upgrade;

        '';
      };
    };


  };

}
