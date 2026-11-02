{
  lib,
  buildGoModule,
  installShellFiles,
  iana-etc,
  libredirect,
  postgresql,
  stdenv,

  headscale-src,
}:
buildGoModule rec {
  pname = "headscale";
  version = "0.29.7";

  src = headscale-src;

  # headscale reads its version from Go build info, which is empty for this build
  postPatch = ''
    substituteInPlace hscontrol/types/version.go \
      --replace-fail 'Version:   "dev"' 'Version: "v${version}"'
  '';

  vendorHash = "sha256-ADl65VpgS3uKYX0dYkRPPKcOelD9sJdwlq+CA0eA7Nk=";

  subPackages = [ "cmd/headscale" ];

  ldflags = [
    "-s"
    "-w"
  ];

  nativeBuildInputs = [ installShellFiles ];

  nativeCheckInputs = [
    libredirect.hook
    postgresql
  ];

  checkFlags = [ "-short" ];

  preCheck = lib.optionalString stdenv.hostPlatform.isDarwin ''
    export NIX_REDIRECTS=/etc/protocols=${iana-etc}/etc/protocols:/etc/services=${iana-etc}/etc/services
  '';

  postInstall = lib.optionalString (stdenv.buildPlatform.canExecute stdenv.hostPlatform) ''
    installShellCompletion --cmd headscale \
      --bash <($out/bin/headscale completion bash) \
      --fish <($out/bin/headscale completion fish) \
      --zsh <($out/bin/headscale completion zsh)
  '';

  meta = {
    homepage = "https://github.com/juanfont/headscale";
    description = "Open source, self-hosted implementation of the Tailscale control server";
    license = lib.licenses.bsd3;
    mainProgram = "headscale";
  };
}
