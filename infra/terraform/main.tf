terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ─── Variables ───

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "db_password" {
  description = "Cloud SQL database password"
  type        = string
  sensitive   = true
}

variable "gcal_oauth_client_id" {
  description = "Google Calendar OAuth Client ID"
  type        = string
  sensitive   = true
  default     = ""
}

variable "gcal_oauth_client_secret" {
  description = "Google Calendar OAuth Client Secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "gcal_refresh_token" {
  description = "Google Calendar OAuth Refresh Token"
  type        = string
  sensitive   = true
  default     = ""
}

variable "asana_token" {
  description = "Asana Personal Access Token"
  type        = string
  sensitive   = true
  default     = ""
}

variable "notion_token" {
  description = "Notion Integration Token"
  type        = string
  sensitive   = true
  default     = ""
}

variable "openai_api_key" {
  description = "OpenAI API Key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "ingress_image" {
  description = "Docker image for ingress service"
  type        = string
  default     = "gcr.io/PROJECT_ID/diligence-ingress:latest"
}

variable "admin_image" {
  description = "Docker image for admin service"
  type        = string
  default     = "gcr.io/PROJECT_ID/diligence-admin:latest"
}

variable "worker_image" {
  description = "Docker image for worker service"
  type        = string
  default     = "gcr.io/PROJECT_ID/diligence-worker:latest"
}

# ─── Enable APIs ───

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "cloudtasks.googleapis.com",
    "cloudscheduler.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "compute.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}
