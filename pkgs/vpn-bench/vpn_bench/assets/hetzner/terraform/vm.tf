resource "hcloud_server" "servers" {
  for_each = { for server in var.servers : server.name => server }

  name        = each.value.name
  server_type = each.value.server_type
  image       = var.os_image
  location    = each.value.location

  # To find the possible options look at the Cloudinit documentation below:
  # https://cloudinit.readthedocs.io/en/latest/reference/yaml_examples/set_passwords.html
  user_data = <<-EOF
    #cloud-config
    ssh_authorized_keys:
      - ${join("\n  - ", var.ssh_pubkeys)}
    ssh_pwauth: false
    chpasswd:
      expire: false
      users:
      - {name: root, password: Sahb7pied8, type: text}
  EOF
}

output "vm_info" {
  description = "Information about each VM, including name, location, server_type, IP address, and user_data"
  value = {
    for server in var.servers :
    server.name => {
      name        = server.name,
      location    = server.location,
      server_type = server.server_type,
      ipv4        = hcloud_server.servers[server.name].ipv4_address,
      ipv6        = hcloud_server.servers[server.name].ipv6_address,
      provider    = "hetzner",
    }
  }
}