{ packages }:
{ ... }:
{
  _class = "clan.service";
  manifest.name = "yggdrasil";

  roles.server = {
    interface = {
      options = {

      };
    };

    perInstance =
      { ... }:
      {
        nixosModule =
          { config, ... }:

          {
            services.yggdrasil = {
              enable = true;
              privateKeyFile = config.clan.core.vars.generators.yggdrasil.files.private-key.path;
            };

          };
      };
  };
}
