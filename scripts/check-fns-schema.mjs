import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const fileName = 'min_ON_TRNACLGROT_1_973_01_05_01_02.xsd'
const url = `https://www.nalog.gov.ru/html/sites/www.new.nalog.ru/files/related_activities/el_doc/el_bus_entities/approved_formats/${fileName}`
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 20_000)

try {
  const response = await fetch(url, {
    signal: controller.signal,
    headers: { 'user-agent': 'epd-light-schema-check/1.0' },
  })
  if (!response.ok) throw new Error(`FNS returned HTTP ${response.status}`)

  const body = await response.text()
  if (body.length < 500 || !/(xs|xsd):schema|<schema/i.test(body)) {
    throw new Error('Response does not look like an XSD schema')
  }

  const sha256 = createHash('sha256').update(body).digest('hex')
  const result = {
    checkedAt: new Date().toISOString(),
    url,
    fileName,
    bytes: Buffer.byteLength(body),
    sha256,
    contentType: response.headers.get('content-type'),
    lastModified: response.headers.get('last-modified'),
    etag: response.headers.get('etag'),
  }

  if (process.argv.includes('--save')) {
    const dir = path.resolve('.cache', 'fns')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, fileName), body, 'utf8')
    await writeFile(path.join(dir, 'metadata.json'), JSON.stringify(result, null, 2), 'utf8')
  }

  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`FNS schema check failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
}
