{
  lib,
  stdenv,
  rustPlatform,
  protobuf,
  nixosTests,
  nix-update-script,
  withQuic ? false, # with QUIC protocol support

  easytier-src,
}:

rustPlatform.buildRustPackage rec {
  pname = "easytier";
  version = "2.3.2";

  src = easytier-src;
  useFetchCargoVendor = true;

  cargoHash = "sha256-n9mOA8FFsFUUiwDVMbREHKb8sqVDOzoU2ZWpedqPeDE=";

  nativeBuildInputs = [
    protobuf
    rustPlatform.bindgenHook
  ];

  buildNoDefaultFeatures = stdenv.hostPlatform.isMips;
  buildFeatures = lib.optional stdenv.hostPlatform.isMips "mips" ++ lib.optional withQuic "quic";

  doCheck = false; # tests failed due to heavy rely on network

  passthru = {
    tests = { inherit (nixosTests) easytier; };
    updateScript = nix-update-script { };
  };

  meta = {
    homepage = "https://github.com/EasyTier/EasyTier";
    changelog = "https://github.com/EasyTier/EasyTier/releases/tag/v${version}";
    description = "Simple, decentralized mesh VPN with WireGuard support";
    longDescription = ''
      EasyTier is a simple, safe and decentralized VPN networking solution implemented
      with the Rust language and Tokio framework.
    '';
    mainProgram = "easytier-core";
    license = lib.licenses.asl20;
    platforms = with lib.platforms; unix ++ windows;
    maintainers = with lib.maintainers; [ ltrump ];
  };
}
