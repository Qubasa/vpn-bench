
resource "google_compute_instance" "$vm_name" {
  boot_disk {
    auto_delete = true
    device_name = "$vm_name"
    initialize_params {
      image = "projects/debian-cloud/global/images/debian-12-bookworm-v20241210"
      size  = 10
      type  = "pd-balanced"
    }
    mode = "READ_WRITE"
  }
  can_ip_forward      = false
  deletion_protection = false
  enable_display      = false
  labels = {
    goog-ec-src = "vm_add-tf"
  }
  machine_type = "e2-medium"
  name         = "$vm_name"
  network_interface {
    access_config {
      network_tier = "PREMIUM"
    }
    queue_count = 0
    stack_type  = "IPV4_ONLY"
    subnetwork  = "projects/vm-benchmark-447115/regions/asia-east2/subnetworks/default"
  }
  scheduling {
    automatic_restart   = true
    on_host_maintenance = "MIGRATE"
    preemptible         = false
    provisioning_model  = "STANDARD"
  }
  service_account {
    email  = "1020900445847-compute@developer.gserviceaccount.com"
    scopes = [
      "https://www.googleapis.com/auth/devstorage.read_only",
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring.write",
      "https://www.googleapis.com/auth/service.management.readonly",
      "https://www.googleapis.com/auth/servicecontrol",
      "https://www.googleapis.com/auth/trace.append"
    ]
  }
  shielded_instance_config {
    enable_integrity_monitoring = true
    enable_secure_boot          = false
    enable_vtpm                 = true
  }
  zone = "asia-east2-a"
}


output "$vm_name" {
  description = "The public IP address for $vm_name"
  value = { ip_address = google_compute_instance.$vm_name.network_interface.0.access_config.0.nat_ip }
}