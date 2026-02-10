# ─── Cloud Run: diligence-ingress (PUBLIC) ───

resource "google_cloud_run_v2_service" "ingress" {
  name     = "diligence-ingress"
  location = var.region

  template {
    service_account = google_service_account.sa_ingress.email

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    containers {
      image = var.ingress_image

      ports {
        container_port = 8080
      }

      env {
        name  = "PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "REGION"
        value = var.region
      }
      env {
        name  = "SERVICE_NAME"
        value = "diligence-ingress"
      }
      env {
        name  = "DATABASE_HOST"
        value = "/cloudsql/${google_sql_database_instance.postgres.connection_name}"
      }
      env {
        name  = "DATABASE_NAME"
        value = "diligence"
      }
      env {
        name  = "DATABASE_USER"
        value = "diligence"
      }
      env {
        name  = "WORKER_URL"
        value = google_cloud_run_v2_service.worker.uri
      }
      env {
        name  = "TASKS_INVOKER_SA_EMAIL"
        value = google_service_account.sa_tasks_invoker.email
      }
      env {
        name  = "TENANT_ID"
        value = "00000000-0000-0000-0000-000000000001"
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }
  }

  depends_on = [google_project_service.apis]
}

# Allow unauthenticated access (public webhook receiver)
resource "google_cloud_run_v2_service_iam_member" "ingress_public" {
  name     = google_cloud_run_v2_service.ingress.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─── Cloud Run: diligence-admin (PRIVATE) ───

resource "google_cloud_run_v2_service" "admin" {
  name     = "diligence-admin"
  location = var.region

  template {
    service_account = google_service_account.sa_admin.email

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = var.admin_image

      ports {
        container_port = 8080
      }

      env {
        name  = "PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "REGION"
        value = var.region
      }
      env {
        name  = "SERVICE_NAME"
        value = "diligence-admin"
      }
      env {
        name  = "DATABASE_HOST"
        value = "/cloudsql/${google_sql_database_instance.postgres.connection_name}"
      }
      env {
        name  = "DATABASE_NAME"
        value = "diligence"
      }
      env {
        name  = "DATABASE_USER"
        value = "diligence"
      }
      env {
        name  = "INGRESS_PUBLIC_BASE_URL"
        value = google_cloud_run_v2_service.ingress.uri
      }
      env {
        name  = "TENANT_ID"
        value = "00000000-0000-0000-0000-000000000001"
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }
  }

  depends_on = [google_project_service.apis]
}

# Allow Cloud Scheduler (sa-admin) to invoke admin service
resource "google_cloud_run_v2_service_iam_member" "admin_scheduler_invoker" {
  name     = google_cloud_run_v2_service.admin.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.sa_admin.email}"
}

# ─── Cloud Run: diligence-worker (PRIVATE) ───

resource "google_cloud_run_v2_service" "worker" {
  name     = "diligence-worker"
  location = var.region

  template {
    service_account = google_service_account.sa_worker.email

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    timeout = "900s"  # 15 min for long-running research tasks

    containers {
      image = var.worker_image

      ports {
        container_port = 8080
      }

      env {
        name  = "PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "REGION"
        value = var.region
      }
      env {
        name  = "SERVICE_NAME"
        value = "diligence-worker"
      }
      env {
        name  = "DATABASE_HOST"
        value = "/cloudsql/${google_sql_database_instance.postgres.connection_name}"
      }
      env {
        name  = "DATABASE_NAME"
        value = "diligence"
      }
      env {
        name  = "DATABASE_USER"
        value = "diligence"
      }
      env {
        name  = "ASANA_PIPELINE_PROJECT_GID"
        value = ""
      }
      env {
        name  = "NOTION_PARENT_PAGE_ID"
        value = ""
      }
      env {
        name  = "LLM_MODEL"
        value = "gpt-4o"
      }
      env {
        name  = "TENANT_ID"
        value = "00000000-0000-0000-0000-000000000001"
      }
      env {
        name  = "WORKER_URL"
        value = "self"
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "1Gi"
        }
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }
  }

  depends_on = [google_project_service.apis]
}

# Grant sa-tasks-invoker the ability to invoke the worker (OIDC auth for Cloud Tasks)
resource "google_cloud_run_v2_service_iam_member" "worker_tasks_invoker" {
  name     = google_cloud_run_v2_service.worker.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.sa_tasks_invoker.email}"
}
