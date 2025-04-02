resource "openstack_networking_secgroup_v2" "secgroup_1" {
  name        = "secgroup_1"
  description = "Security group with all ports open"
}

# Allow all IPv4 ingress traffic
resource "openstack_networking_secgroup_rule_v2" "secgroup_rule_ipv4_all" {
  security_group_id = openstack_networking_secgroup_v2.secgroup_1.id
  direction         = "ingress"
  ethertype         = "IPv4"
  remote_ip_prefix  = "0.0.0.0/0"
}

# Allow all IPv6 ingress traffic
resource "openstack_networking_secgroup_rule_v2" "secgroup_rule_ipv6_all" {
  security_group_id = openstack_networking_secgroup_v2.secgroup_1.id
  direction         = "ingress"
  ethertype         = "IPv6"
  remote_ip_prefix  = "::/0"
}

# Get external network information
data "openstack_networking_network_v2" "external_network" {
  name = "public"  # Use your actual external network name
}

# Create an IPv6 network
resource "openstack_networking_network_v2" "ipv6_network" {
  name           = "ipv6_network"
  admin_state_up = true
}

# Create an IPv6 subnet with public addressing
resource "openstack_networking_subnet_v2" "ipv6_subnet" {
  name               = "ipv6_subnet"
  network_id         = openstack_networking_network_v2.ipv6_network.id
  cidr               = "2001:db8::/64"  # Using documentation prefix - this will be replaced by actual allocation
  ip_version         = 6
  ipv6_address_mode  = "slaac"  # Stateless address autoconfiguration
  ipv6_ra_mode       = "slaac"  # Router advertisement mode
  enable_dhcp        = true
  no_gateway         = false    # Ensure gateway is enabled
}

# Create router for IPv6 connectivity
resource "openstack_networking_router_v2" "ipv6_router" {
  name                = "ipv6_router"
  admin_state_up      = true
  external_network_id = data.openstack_networking_network_v2.external_network.id
}

# Attach IPv6 subnet to the router
resource "openstack_networking_router_interface_v2" "ipv6_router_interface" {
  router_id = openstack_networking_router_v2.ipv6_router.id
  subnet_id = openstack_networking_subnet_v2.ipv6_subnet.id
}

# Create ports for each VM to get predictable IPv6 addresses
resource "openstack_networking_port_v2" "vm_port" {
  for_each       = { for server in var.servers : server.name => server }
  name           = "port-${each.key}"
  network_id     = openstack_networking_network_v2.ipv6_network.id
  admin_state_up = true
  
  security_group_ids = [openstack_networking_secgroup_v2.secgroup_1.id]
  
  fixed_ip {
    subnet_id = openstack_networking_subnet_v2.ipv6_subnet.id
  }
}

# Update VM instances to use the predefined ports
resource "openstack_compute_instance_v2" "vpb_instances" {
  for_each    = { for server in var.servers : server.name => server }
  name        = each.value.name
  image_name  = var.os_image
  flavor_name = each.value.server_type

  network {
    name = "sharednet1"
  }
  
  network {
    port = openstack_networking_port_v2.vm_port[each.key].id
  }

  security_groups = [openstack_networking_secgroup_v2.secgroup_1.id]

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

# IPv4 floating IPs
resource "openstack_networking_floatingip_v2" "fip_ipv4" {
  for_each = openstack_compute_instance_v2.vpb_instances
  pool     = "public"  # External network for floating IPs
}

resource "openstack_compute_floatingip_associate_v2" "assoc_ipv4" {
  for_each    = openstack_compute_instance_v2.vpb_instances
  instance_id = each.value.id
  floating_ip = openstack_networking_floatingip_v2.fip_ipv4[each.key].address
}

# Output with both IPv4 and IPv6 addresses
output "vm_info" {
  description = "Information about each VM, including name, server_type, IP addresses, and provider"
  value = {
    for name, instance in openstack_compute_instance_v2.vpb_instances : name => {
      name        = instance.name
      server_type = instance.flavor_name
      ipv4        = openstack_networking_floatingip_v2.fip_ipv4[name].address
      # Get the IPv6 address from the network port
      internal_ipv6        = [for ip in openstack_networking_port_v2.vm_port[name].all_fixed_ips : ip if can(regex(":", ip))][0]
      provider    = "chameleon"
    }
  }
}