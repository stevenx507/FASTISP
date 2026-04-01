import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  vus: 2,
  duration: '30s',
}

const BASE_URL = __ENV.BASE_URL || 'https://httpbin.org'

export default function () {
  const res = http.get(`${BASE_URL}/get`)
  check(res, {
    'status is 200': (r) => r.status === 200,
  })
  sleep(1)
}
