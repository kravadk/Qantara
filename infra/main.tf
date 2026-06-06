# Qantara — infrastructure as code (deploy-ready scaffolding).
#
# NOT applied in CI. Requires real credentials and `terraform init`. Fill
# terraform.tfvars (see terraform.tfvars.example) before `terraform plan`.
#
# Hosting model: Vercel (static frontend) + Railway (backend + persistent
# volume). Runtime secrets (API_KEY, WEBHOOK_SECRET, PAYMENT_INTENT_SECRET,
# SIWE_JWT_SECRET, real QUSDC_ADDRESS, BOT_TOKEN, ...) are set in the platform
# dashboards / a secrets manager — never committed here.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 2.0"
    }
    railway = {
      source  = "terraform-community-providers/railway"
      version = "~> 0.4"
    }
  }
}

provider "vercel" {
  api_token = var.vercel_api_token
}

provider "railway" {
  token = var.railway_token
}

# --- Frontend (Vercel) ------------------------------------------------------
resource "vercel_project" "frontend" {
  name      = "${var.project_name}-frontend"
  framework = "vite"

  git_repository = {
    type = "github"
    repo = var.github_repo
  }

  # Only PUBLIC values belong in the frontend build. No API keys here.
  environment = [
    {
      key    = "VITE_QANTARA_BACKEND_URL"
      value  = var.vite_qantara_backend_url
      target = ["production"]
    },
  ]
}

resource "vercel_project_domain" "frontend" {
  project_id = vercel_project.frontend.id
  domain     = var.frontend_domain
}

# --- Backend (Railway) ------------------------------------------------------
resource "railway_project" "backend" {
  name = "${var.project_name}-backend"
}

resource "railway_service" "backend" {
  project_id = railway_project.backend.id
  name       = "backend"
}

# Persistent volume for the SQLite database (mounted at /app/data).
resource "railway_volume" "backend_data" {
  project_id = railway_project.backend.id
  service_id = railway_service.backend.id
  mount_path = "/app/data"
  name       = "${var.project_name}-sqlite"
}

output "frontend_domain" {
  value = var.frontend_domain
}

output "backend_service" {
  value = railway_service.backend.name
}
