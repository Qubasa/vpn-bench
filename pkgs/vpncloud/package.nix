{
  lib,
  rustPlatform,

  vpncloud-src,
}:

rustPlatform.buildRustPackage {
  name = "vpncloud";

  src = vpncloud-src;

  useFetchCargoVendor = true;
  cargoHash = "sha256-iOOPQziPkxFPiQXMSF3NhJ0mTj3pIV7JDUm+5PS+KLo=";

  meta = {
    mainProgram = "vpncloud";
    description = "Fast line-oriented regex search tool, similar to ag and ack";
    homepage = "https://vpncloud.ddswd.de/";
    license = lib.licenses.gpl3;
    maintainers = [ ];
  };
}
