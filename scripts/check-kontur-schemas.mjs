import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  KONTUR_T1_CONTRACT,
  discoverKonturT1Descriptor,
  getKonturContent,
  konturConfigFromEnv,
  konturConfigStatus,
} from '../server/providers/kontur.mjs'

const save = process.argv.includes('--save')
const config = konturConfigFromEnv()
const status = konturConfigStatus(config)
if (!status.configured) {
  console.error(`Kontur schema check requires server env: ${status.missing.join(', ')}`)
  process.exit(2)
}

const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const looksLikeXsd = (text) => /<(?:xs|xsd):schema\b/i.test(String(text || ''))

const descriptor = await discoverKonturT1Descriptor({ boxId: config.boxId, accessToken: config.accessToken })
const [titleXsd, userDataXsd] = await Promise.all([
  getKonturContent({ contentPath: descriptor.xsdUrl, accessToken: config.accessToken }),
  getKonturContent({ contentPath: descriptor.userDataXsdUrl, accessToken: config.accessToken }),
])

if (!looksLikeXsd(titleXsd)) throw new Error('Kontur Title XSD response does not look like an XSD schema')
if (!looksLikeXsd(userDataXsd)) throw new Error('Kontur UserDataXsd response does not look like an XSD schema')

const report = {
  checkedAt: new Date().toISOString(),
  contract: KONTUR_T1_CONTRACT,
  descriptor,
  titleXsd: { sha256: hash(titleXsd), bytes: Buffer.byteLength(titleXsd, 'utf8') },
  userDataXsd: { sha256: hash(userDataXsd), bytes: Buffer.byteLength(userDataXsd, 'utf8') },
}

console.log(JSON.stringify(report, null, 2))

if (save) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const dir = path.join(root, '.cache', 'kontur')
  await mkdir(dir, { recursive: true })
  const stem = `${KONTUR_T1_CONTRACT.documentTypeNamedId}_${KONTUR_T1_CONTRACT.documentFunction}_${KONTUR_T1_CONTRACT.documentVersion}_title${KONTUR_T1_CONTRACT.titleIndex}`
  await Promise.all([
    writeFile(path.join(dir, `${stem}.xsd`), titleXsd, 'utf8'),
    writeFile(path.join(dir, `${stem}.userdata.xsd`), userDataXsd, 'utf8'),
    writeFile(path.join(dir, `${stem}.metadata.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  ])
  console.log(`Saved Kontur schemas to ${dir}`)
}
