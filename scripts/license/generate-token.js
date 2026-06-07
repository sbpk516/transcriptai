#!/usr/bin/env node
'use strict'

// Mint a signed license token for a paying customer.
//
//   node scripts/license/generate-token.js --name "Jane Doe" --email jane@x.com
//   node scripts/license/generate-token.js --name "Jane" --exp 2027-01-01   (subscription)
//
// Lifetime by default (no --exp). Requires scripts/license/private-key.pem
// (created by generate-keypair.js). Send the printed token to the customer; they
// paste it into the app's "Enter license token" field.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }

const privPath = path.join(__dirname, 'private-key.pem')
if (!fs.existsSync(privPath)) {
  console.error('Missing private-key.pem — run: node scripts/license/generate-keypair.js')
  process.exit(1)
}
const privateKey = crypto.createPrivateKey(fs.readFileSync(privPath))

const expIso = arg('--exp') ? new Date(arg('--exp')).toISOString() : null
const payload = {
  v: 1,
  type: expIso ? 'subscription' : 'lifetime',
  id: crypto.randomUUID(),
  iat: new Date().toISOString(),
}
if (arg('--name')) payload.name = arg('--name')
if (arg('--email')) payload.email = arg('--email')
if (expIso) payload.exp = expIso

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
const sig = crypto.sign(null, Buffer.from(payloadB64, 'utf8'), privateKey)
const token = `${payloadB64}.${b64url(sig)}`

console.log('Payload :', JSON.stringify(payload))
console.log('\nLicense token (send to customer):\n')
console.log(token)
console.log('')
