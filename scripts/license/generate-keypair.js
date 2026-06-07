#!/usr/bin/env node
'use strict'

// One-time setup: generate an Ed25519 keypair for offline license tokens.
//
//   node scripts/license/generate-keypair.js
//
// - Writes the PRIVATE key to scripts/license/private-key.pem (GITIGNORED — keep secret;
//   it is what mints license tokens for paying customers).
// - Prints the PUBLIC key PEM to embed in desktop/src/main/license-manager.js
//   (LICENSE_PUBLIC_KEY_PEM). The public key only verifies tokens; safe to ship.
//
// Run this ONCE. If you regenerate, every previously issued token stops validating.

const { generateKeyPairSync } = require('crypto')
const fs = require('fs')
const path = require('path')

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pubPem = publicKey.export({ type: 'spki', format: 'pem' })
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' })

const privPath = path.join(__dirname, 'private-key.pem')
if (fs.existsSync(privPath)) {
  console.error(`Refusing to overwrite existing ${privPath}. Delete it first if you truly want a new keypair.`)
  process.exit(1)
}
fs.writeFileSync(privPath, privPem, { mode: 0o600 })

console.log('Private key written to:', privPath, '(keep this secret, never commit)')
console.log('\n=== PUBLIC KEY — paste into desktop/src/main/license-manager.js LICENSE_PUBLIC_KEY_PEM ===\n')
process.stdout.write(pubPem)
