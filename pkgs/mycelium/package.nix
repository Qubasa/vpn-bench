{
  lib,
  rustPlatform,
  openssl,
  versionCheckHook,

  mycelium-src,
}:

rustPlatform.buildRustPackage rec {
  pname = "mycelium";
  version = "0.6.1";

  sourceRoot = "source/myceliumd";

  src = mycelium-src;

  cargoHash = "sha256-5TyJNYBTULSu886D+vy8YRh50oFBubNZ9KkMu1/PvgU=";

  nativeBuildInputs = [ versionCheckHook ];

  doInstallCheck = true;

  env = {
    OPENSSL_NO_VENDOR = 1;
    OPENSSL_LIB_DIR = "${lib.getLib openssl}/lib";
    OPENSSL_DIR = "${lib.getDev openssl}";
  };

  meta = {
    description = "End-2-end encrypted IPv6 overlay network";
    homepage = "https://github.com/threefoldtech/mycelium";
    changelog = "https://github.com/threefoldtech/mycelium/blob/v${version}/CHANGELOG.md";
    license = lib.licenses.asl20;
    mainProgram = "mycelium";
  };
}
