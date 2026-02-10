# ─── Service Accounts ───

resource "google_service_account" "sa_ingress" {
  account_id   = "sa-ingress"
  display_name = "Diligence Ingress Service Account"
  depends_on   = [google_project_service.apis]
}

resource "google_service_account" "sa_admin" {
  account_id   = "sa-admin"
  display_name = "Diligence Admin Service Account"
  depends_on   = [google_project_service.apis]
}

resource "google_service_account" "sa_worker" {
  account_id   = "sa-worker"
  display_name = "Diligence Worker Service Account"
  depends_on   = [google_project_service.apis]
}

resource "google_service_account" "sa_tasks_invoker" {
  account_id   = "sa-tasks-invoker"
  display_name = "Cloud Tasks OIDC Invoker"
  depends_on   = [google_project_service.apis]
}

# ─── IAM: sa-ingress ───

# Cloud Tasks enqueuer
resource "google_project_iam_member" "ingress_tasks_enqueuer" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.sa_ingress.email}"
}

# Secret Manager access
resource "google_project_iam_member" "ingress_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.sa_ingress.email}"
}

# Cloud SQL client
resource "google_project_iam_member" "ingress_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.sa_ingress.email}"
}

# Logging
resource "google_project_iam_member" "ingress_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.sa_ingress.email}"
}

# Allow sa-ingress to "actAs" sa-tasks-invoker for OIDC tokens on tasks
resource "google_service_account_iam_member" "ingress_actas_tasks_invoker" {
  service_account_id = google_service_account.sa_tasks_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.sa_ingress.email}"
}

# ─── IAM: sa-admin ───

resource "google_project_iam_member" "admin_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.sa_admin.email}"
}

resource "google_project_iam_member" "admin_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.sa_admin.email}"
}

resource "google_project_iam_member" "admin_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.sa_admin.email}"
}

# ─── IAM: sa-worker ───

resource "google_project_iam_member" "worker_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.sa_worker.email}"
}

resource "google_project_iam_member" "worker_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.sa_worker.email}"
}

resource "google_project_iam_member" "worker_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.sa_worker.email}"
}

# ─── IAM: sa-tasks-invoker → can invoke worker ───
# (Defined in cloud-run.tf after the worker service is created)
