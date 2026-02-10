# ─── Cloud Tasks Queues ───

resource "google_cloud_tasks_queue" "q_gcal_sync" {
  name     = "q-gcal-sync"
  location = var.region

  retry_config {
    max_attempts       = 5
    min_backoff        = "10s"
    max_backoff        = "300s"
    max_doublings      = 3
    max_retry_duration = "3600s"
  }

  rate_limits {
    max_dispatches_per_second = 5
    max_concurrent_dispatches = 3
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_tasks_queue" "q_asana_events" {
  name     = "q-asana-events"
  location = var.region

  retry_config {
    max_attempts       = 5
    min_backoff        = "5s"
    max_backoff        = "120s"
    max_doublings      = 3
    max_retry_duration = "1800s"
  }

  rate_limits {
    max_dispatches_per_second = 10
    max_concurrent_dispatches = 5
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_tasks_queue" "q_stage_actions" {
  name     = "q-stage-actions"
  location = var.region

  retry_config {
    max_attempts       = 3
    min_backoff        = "30s"
    max_backoff        = "600s"
    max_doublings      = 2
    max_retry_duration = "3600s"
  }

  rate_limits {
    max_dispatches_per_second = 5
    max_concurrent_dispatches = 3
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_tasks_queue" "q_research" {
  name     = "q-research"
  location = var.region

  retry_config {
    max_attempts       = 3
    min_backoff        = "60s"
    max_backoff        = "900s"
    max_doublings      = 2
    max_retry_duration = "7200s"
  }

  rate_limits {
    max_dispatches_per_second = 3
    max_concurrent_dispatches = 6
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_tasks_queue" "q_maintenance" {
  name     = "q-maintenance"
  location = var.region

  retry_config {
    max_attempts       = 3
    min_backoff        = "60s"
    max_backoff        = "300s"
    max_doublings      = 2
    max_retry_duration = "3600s"
  }

  rate_limits {
    max_dispatches_per_second = 1
    max_concurrent_dispatches = 1
  }

  depends_on = [google_project_service.apis]
}
