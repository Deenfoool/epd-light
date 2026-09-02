const COMMIT_RE = /^[0-9a-f]{7,64}$/i
const RELEASE_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/

function safeRelease(value) {
  const release = String(value || '').trim()
  return RELEASE_RE.test(release) ? release : 'unknown'
}

function safeCommit(value) {
  const commit = String(value || '').trim().toLowerCase()
  return COMMIT_RE.test(commit) ? commit : 'unknown'
}

function safeBuildTime(value) {
  const raw = String(value || '').trim()
  if (!raw) return 'unknown'
  const date = new Date(raw)
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'unknown'
}

export function buildInfoFromEnv(env = process.env) {
  return Object.freeze({
    release: safeRelease(env.EPD_RELEASE || '0.1.0'),
    commit: safeCommit(env.EPD_BUILD_COMMIT),
    buildTime: safeBuildTime(env.EPD_BUILD_TIME),
  })
}

export function buildPublicInfo(info = buildInfoFromEnv()) {
  return {
    service: 'epd-light-gateway',
    release: info.release,
    commit: info.commit,
    shortCommit: info.commit === 'unknown' ? 'unknown' : info.commit.slice(0, 12),
    buildTime: info.buildTime,
    traceableBuild: info.commit !== 'unknown' && info.buildTime !== 'unknown',
    sensitiveValuesIncluded: false,
  }
}
