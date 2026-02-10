# ─── Outputs ───

output "ingress_url" {
  description = "Public URL for the ingress service (webhook receiver)"
  value       = google_cloud_run_v2_service.ingress.uri
}

output "admin_url" {
  description = "Private URL for the admin service"
  value       = google_cloud_run_v2_service.admin.uri
}

output "worker_url" {
  description = "Private URL for the worker service"
  value       = google_cloud_run_v2_service.worker.uri
}

output "cloud_sql_connection" {
  description = "Cloud SQL connection name"
  value       = google_sql_database_instance.postgres.connection_name
}

output "sa_ingress_email" {
  description = "Ingress service account email"
  value       = google_service_account.sa_ingress.email
}

output "sa_admin_email" {
  description = "Admin service account email"
  value       = google_service_account.sa_admin.email
}

output "sa_worker_email" {
  description = "Worker service account email"
  value       = google_service_account.sa_worker.email
}

output "sa_tasks_invoker_email" {
  description = "Tasks invoker service account email"
  value       = google_service_account.sa_tasks_invoker.email
}
