# Client-side encryption of state and plan files (D94). R2 only ever holds ciphertext, so a leaked
# bucket token reads nothing. enforced = true makes OpenTofu refuse to read or write either in
# plaintext; scripts/infra-guard.sh checks both stay enforced.
terraform {
  encryption {
    key_provider "pbkdf2" "passphrase" {
      passphrase = var.state_passphrase
    }

    method "aes_gcm" "passphrase" {
      keys = key_provider.pbkdf2.passphrase
    }

    state {
      method   = method.aes_gcm.passphrase
      enforced = true
    }

    plan {
      method   = method.aes_gcm.passphrase
      enforced = true
    }
  }
}
