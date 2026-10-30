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
  version = "0.27.0";

  src = headscale-src;

  vendorHash = "sha256-GUIzlPRsyEq1uSTzRNds9p1uVu4pTeH5PAxrJ5Njhis=";

  subPackages = [ "cmd/headscale" ];

  ldflags = [
    "-s"
    "-w"
    "-X github.com/juanfont/headscale/cmd/headscale/cli.Version=v${version}"
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
