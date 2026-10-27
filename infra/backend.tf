# State lives in R2, encrypted before it leaves the machine (encryption.tf, D94). The bucket is
# made by hand (docs/deployment.md, "Infrastructure as code"): state can't describe the bucket
# that holds it. R2 isn't AWS, hence the skip_* flags.
terraform {
  backend "s3" {
    bucket         = "hanker-tofu-state"
    key            = "infra/terraform.tfstate"
    region         = "auto"
    endpoints      = { s3 = local.r2_endpoint }
    use_path_style = true

    # R2 evaluates If-None-Match on PutObject atomically, which native locking needs. CI plans
    # with -lock=false and a read-only token, so only a local run ever takes the lock.
    use_lockfile = true

    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}
