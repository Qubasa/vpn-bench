



resource "hcloud_server" "servers" {
  for_each = { for server in var.servers : server.name => server }

  name        = each.value.name
  server_type = each.value.server_type
  image       = var.os_image
  location    = each.value.location

  user_data = <<-EOF
    #cloud-config
    ssh_authorized_keys:
      - ${var.ssh_pubkey}
  EOF
}

output "vm_info" {
  description = "Information about each VM, including name, location, server_type, and IP address"
  value = {
    for server in var.servers :
    server.name => {
      name        = server.name,
      location    = server.location,
      server_type = server.server_type,
      ipv4  = hcloud_server.servers[server.name].ipv4_address
    }
  }
}