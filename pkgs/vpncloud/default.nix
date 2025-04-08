{
  lib,
  fetchFromGitHub,
  rustPlatform,
}:

rustPlatform.buildRustPackage rec {
  name = "vpncloud";

  src = fetchFromGitHub {
    owner = "dswd";
    repo = name;
    rev = "bef99162fe0d66e2c9fbf6421a69ca8ec2ac8f55";
    hash = "sha256-nGI5jPAQYPv9YEsl1qCUKJ28IKHf8BCeOVgct+aYfw4=";
  };

  useFetchCargoVendor = true;
  cargoHash = "sha256-iOOPQziPkxFPiQXMSF3NhJ0mTj3pIV7JDUm+5PS+KLo=";

  meta = {
    description = "Fast line-oriented regex search tool, similar to ag and ack";
    homepage = "https://vpncloud.ddswd.de/";
    license = lib.licenses.gpl3;
    maintainers = [ ];
  };
}
