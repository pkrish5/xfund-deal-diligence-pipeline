# ─── Secret Manager Secrets ───

locals {
  secrets = {
    GCAL_OAUTH_CLIENT_ID     = var.gcal_oauth_client_id
    GCAL_OAUTH_CLIENT_SECRET = var.gcal_oauth_client_secret
    GCAL_REFRESH_TOKEN       = var.gcal_refresh_token
    ASANA_TOKEN              = var.asana_token
    NOTION_TOKEN             = var.notion_token
    OPENAI_API_KEY           = var.openai_api_key
    DB_PASSWORD              = var.db_password
  }
}

resource "google_secret_manager_secret" "secrets" {
  for_each  = local.secrets
  secret_id = each.key

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "secret_values" {
  for_each    = { for k, v in local.secrets : k => v if v != "" }
  secret      = google_secret_manager_secret.secrets[each.key].id
  secret_data = each.value
}
