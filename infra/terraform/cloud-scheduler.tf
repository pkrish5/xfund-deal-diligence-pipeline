# ─── Cloud Scheduler Jobs ───

# Replace GCal watch every 12 hours (Google doesn't auto-renew channels)
resource "google_cloud_scheduler_job" "replace_gcal_watch" {
  name      = "replace-gcal-watch"
  region    = var.region
  schedule  = "0 */12 * * *"
  time_zone = "America/Chicago"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.admin.uri}/admin/gcal/watch/replace"
    body        = base64encode("{}")

    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.sa_admin.email
      audience              = google_cloud_run_v2_service.admin.uri
    }
  }

  retry_config {
    retry_count          = 3
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
  }

  depends_on = [google_project_service.apis]
}

# Daily housekeeping (cleanup idempotency keys, expired watches)
resource "google_cloud_scheduler_job" "housekeeping" {
  name      = "daily-housekeeping"
  region    = var.region
  schedule  = "0 3 * * *"
  time_zone = "America/Chicago"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.admin.uri}/admin/housekeeping"
    body        = base64encode("{}")

    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.sa_admin.email
      audience              = google_cloud_run_v2_service.admin.uri
    }
  }

  retry_config {
    retry_count          = 2
    min_backoff_duration = "60s"
    max_backoff_duration = "600s"
  }

  depends_on = [google_project_service.apis]
}
