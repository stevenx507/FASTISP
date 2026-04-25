/**
 * cross_reference.mjs
 * Compares frontend API calls against backend routes and finds mismatches.
 */
import { readFileSync } from 'fs'

const fe = readFileSync('frontend_api_calls.txt', 'utf-8').trim().split('\n').map(l => l.trim()).filter(Boolean)
const be = readFileSync('../backend/backend_routes.txt', 'utf-8').trim().split('\n').map(l => l.trim()).filter(Boolean)

// Normalise backend routes: <int:x> <string:x> etc. → :id
function normalise(route) {
  return route.replace(/<(?:int|string|float):[^>]+>/g, ':id').replace(/<[^>]+>/g, ':id')
}

const backendSet = new Set(be.map(normalise))

const missing = []
const ok = []

for (const call of fe) {
  const normalised = normalise(call)
  if (backendSet.has(normalised)) {
    ok.push(call)
  } else {
    missing.push(call)
  }
}

console.log('=== ✅  MATCHED ENDPOINTS ===')
ok.forEach(l => console.log('  ✓', l))

console.log('\n=== ❌  FRONTEND CALLS WITH NO MATCHING BACKEND ROUTE ===')
missing.forEach(l => console.log('  ✗', l))

console.log(`\nMatched: ${ok.length} / ${fe.length}  |  Missing: ${missing.length}`)
