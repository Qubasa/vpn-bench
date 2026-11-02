{
  lib,
  stdenv,
  rustPlatform,
  protobuf,
  mold,
  nixosTests,
  nix-update-script,
  withQuic ? false, # with QUIC protocol support

  easytier-src,
}:

rustPlatform.buildRustPackage rec {
  pname = "easytier";
  version = "2.7.0-unstable-2026-10-31";

  src = easytier-src;
  useFetchCargoVendor = true;

  cargoHash = "sha256-TTIw6mPt2ah/5p/emzVfyKFP5nUysrciafRPGb09kms=";

  nativeBuildInputs = [
    protobuf
    rustPlatform.bindgenHook
    # upstream's .cargo/config.toml links x86_64/aarch64 Linux with -fuse-ld=mold
    mold
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
