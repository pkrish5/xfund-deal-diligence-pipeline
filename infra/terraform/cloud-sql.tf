# ─── Cloud SQL Postgres Instance ───

resource "google_sql_database_instance" "postgres" {
  name             = "diligence-postgres"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = "db-f1-micro"
    availability_type = "ZONAL"

    ip_configuration {
      ipv4_enabled = true
    }

    backup_configuration {
      enabled = true
    }

    database_flags {
      name  = "max_connections"
      value = "100"
    }
  }

  deletion_protection = true
  depends_on          = [google_project_service.apis]
}

resource "google_sql_database" "diligence" {
  name     = "diligence"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "diligence" {
  name     = "diligence"
  instance = google_sql_database_instance.postgres.name
  password = var.db_password
}
