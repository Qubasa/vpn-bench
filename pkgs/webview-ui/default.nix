{
  lib,
  buildNpmPackage,
  nodejs_18,
  importNpmLock,
  fonts,
  benchDir ? null,
}:

buildNpmPackage {
  pname = "clan-webview-ui";
  version = "0.0.1";
  nodejs = nodejs_18;
  src = ./app;

  npmDeps = importNpmLock { npmRoot = ./app; };
  npmConfigHook = importNpmLock.npmConfigHook;

  preBuild =
    ''
      cp -r ${fonts} ".fonts"
    ''
    + lib.optionalString (benchDir != null) ''
      rm -rf bench
      cp -r ${benchDir} bench
      ls -la bench
    '';
}
