# The state and plan passphrase (TOFU_STATE_PASSPHRASE in CI; Ted's password manager locally).
# Supply it as TF_VAR_state_passphrase, never on the command line.
variable "state_passphrase" {
  type      = string
  sensitive = true

  validation {
    condition     = length(var.state_passphrase) >= 16
    error_message = "The state passphrase must be at least 16 characters (pbkdf2's minimum)."
  }
}
