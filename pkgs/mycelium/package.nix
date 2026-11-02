{
  lib,
  rustPlatform,
  openssl,
  versionCheckHook,

  mycelium-src,
}:

rustPlatform.buildRustPackage rec {
  pname = "mycelium";
  version = "0.7.10";

  sourceRoot = "source/myceliumd";

  src = mycelium-src;

  cargoHash = "sha256-heHR/iR5OUctvXh6HUpfrJtoKeziY6bqT0vkXPOEjIU=";

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
