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
  # benchData.tsx bundles every bench JSON eagerly. `vpb build-ui` copies the whole local
  # bench dir (195 MB in 51 runs on 2026-11-12), which exceeds node's default ~4 GB heap.
  env.NODE_OPTIONS = "--max-old-space-size=12288";

  preBuild = ''
    cp -r ${fonts} ".fonts"
  ''
  + lib.optionalString (benchDir != null) ''
    rm -rf bench
    cp -r ${benchDir} bench
    ls -la bench
  '';
}
