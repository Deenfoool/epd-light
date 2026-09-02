import { readFile } from 'node:fs/promises'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const nginx = await readFile('deploy/nginx-compose.conf', 'utf8')
const caddy = await readFile('deploy/Caddyfile.example', 'utf8')

for (const snippet of [
  'Content-Security-Policy',
  "default-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "connect-src 'self' https: wss:",
  'Cross-Origin-Opener-Policy "same-origin"',
  'X-Content-Type-Options "nosniff"',
  'X-Frame-Options "DENY"',
  'Permissions-Policy "camera=(), microphone=(), geolocation=()"',
]) assert(nginx.includes(snippet), `nginx security header missing: ${snippet}`)

assert(nginx.includes('expires 1y;'), 'static assets must receive long cache lifetime without location add_header')
assert(nginx.includes('expires -1;'), 'SPA HTML must be no-cache without location add_header')
assert(!nginx.includes('add_header Cache-Control'), 'location-level Cache-Control add_header would break server security-header inheritance')

const locationBlocks = nginx.split(/\n\s*location\s+/).slice(1)
for (const block of locationBlocks) {
  assert(!/\badd_header\b/.test(block), 'security headers must stay inherited: location block contains add_header')
}

for (const snippet of [
  'Strict-Transport-Security',
  'Content-Security-Policy',
  "script-src 'self'",
  "object-src 'none'",
  'Cross-Origin-Opener-Policy "same-origin"',
  '-Server',
]) assert(caddy.includes(snippet), `Caddy edge security header missing: ${snippet}`)

assert(!nginx.includes("script-src 'self' 'unsafe-inline'"), 'inline scripts must remain forbidden by CSP')

console.log('Web security test OK: CSP, frame/object restrictions, TLS edge headers and nginx inheritance verified')
