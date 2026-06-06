variable "vercel_api_token" {
  type        = string
  sensitive   = true
  description = "Vercel API token (frontend hosting)."
}

variable "railway_token" {
  type        = string
  sensitive   = true
  description = "Railway account/project token (backend hosting)."
}

variable "project_name" {
  type        = string
  default     = "qantara"
  description = "Base name for created resources."
}

variable "frontend_domain" {
  type        = string
  default     = "qantara.app"
  description = "Public frontend domain."
}

variable "backend_domain" {
  type        = string
  default     = "api.qantara.app"
  description = "Public backend API domain."
}

variable "vite_qantara_backend_url" {
  type        = string
  default     = "https://api.qantara.app"
  description = "Public backend URL baked into the frontend build."
}

variable "github_repo" {
  type        = string
  default     = "your-org/qantara"
  description = "owner/name of the source repo for git-connected deploys."
}
