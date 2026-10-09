export const SUBMIT_SCRIPT = `
local existing = redis.call('GET', KEYS[3])
if existing then return {'DUPLICATE', existing} end
local outstanding = tonumber(redis.call('GET', KEYS[1]) or '0')
if outstanding >= tonumber(ARGV[1]) then return {'FULL', ''} end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('LPUSH', KEYS[4], ARGV[3])
redis.call('INCR', KEYS[1])
if ARGV[4] == '1' then redis.call('SET', KEYS[3], ARGV[3]) end
return {'ADMITTED', ARGV[3]}
`;

export const CLAIM_SCRIPT = `
for i = 1, 4 do
  for scan = 1, 100 do
    local id = redis.call('RPOP', KEYS[i])
    if not id then break end
    local jobKey = ARGV[1] .. id
    local raw = redis.call('GET', jobKey)
    if raw then
      local job = cjson.decode(raw)
      if job.state == 'queued' then
        job.state = 'running'; job.attempts = job.attempts + 1
        job.startedAt = tonumber(ARGV[2]); job.updatedAt = tonumber(ARGV[2])
        job.lease = {token=ARGV[3], workerId=ARGV[4], expiresAt=tonumber(ARGV[5])}
        local encoded = cjson.encode(job)
        redis.call('SET', jobKey, encoded)
        redis.call('ZADD', KEYS[5], ARGV[5], id)
        return {id, encoded}
      end
    end
  end
end
return nil
`;

export const COMPLETE_SCRIPT = `
local raw = redis.call('GET', KEYS[1]); if not raw then return 'NOT_FOUND' end
local job = cjson.decode(raw)
if job.state == 'completed' or job.state == 'dead_lettered' then return 'ALREADY_TERMINAL' end
if job.state ~= 'running' then return 'INVALID_STATE' end
if not job.lease or job.lease.token ~= ARGV[1] then return 'STALE_LEASE' end
job.state='completed'; job.completedAt=tonumber(ARGV[2]); job.updatedAt=tonumber(ARGV[2]); job.lease=nil
redis.call('SET', KEYS[1], cjson.encode(job)); redis.call('ZREM', KEYS[2], ARGV[3]); redis.call('DECR', KEYS[3])
return 'APPLIED'
`;

export const RETRY_SCRIPT = `
local raw = redis.call('GET', KEYS[1]); if not raw then return 'NOT_FOUND' end
local job = cjson.decode(raw)
if job.state ~= 'running' then return 'INVALID_STATE' end
if not job.lease or job.lease.token ~= ARGV[1] then return 'STALE_LEASE' end
job.state='retry_scheduled'; job.availableAt=tonumber(ARGV[2]); job.updatedAt=tonumber(ARGV[3]); job.lastFailure=cjson.decode(ARGV[4]); job.lease=nil
redis.call('SET', KEYS[1], cjson.encode(job)); redis.call('ZREM', KEYS[2], ARGV[5]); redis.call('ZADD', KEYS[3], ARGV[2], ARGV[5])
return 'APPLIED'
`;

export const DEAD_LETTER_SCRIPT = `
local raw = redis.call('GET', KEYS[1]); if not raw then return 'NOT_FOUND' end
local job = cjson.decode(raw)
if job.state == 'completed' or job.state == 'dead_lettered' then return 'ALREADY_TERMINAL' end
if job.state ~= 'running' then return 'INVALID_STATE' end
if not job.lease or job.lease.token ~= ARGV[1] then return 'STALE_LEASE' end
job.state='dead_lettered'; job.completedAt=tonumber(ARGV[2]); job.updatedAt=tonumber(ARGV[2]); job.lastFailure=cjson.decode(ARGV[3]); job.lease=nil
redis.call('SET', KEYS[1], cjson.encode(job)); redis.call('ZREM', KEYS[2], ARGV[4]); redis.call('LPUSH', KEYS[3], ARGV[4]); redis.call('DECR', KEYS[4])
return 'APPLIED'
`;

export const RENEW_SCRIPT = `
local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
local job=cjson.decode(raw); if job.state~='running' or not job.lease or job.lease.token~=ARGV[1] then return 0 end
job.lease.expiresAt=tonumber(ARGV[2]); job.updatedAt=tonumber(ARGV[3]); redis.call('SET',KEYS[1],cjson.encode(job)); redis.call('ZADD',KEYS[2],ARGV[2],ARGV[4]); return 1
`;

export function transitionResult(code: unknown): { applied: boolean; reason?: "stale_lease" | "invalid_state" | "already_terminal" | "not_found" } {
  if (code === "APPLIED") return { applied: true };
  const reasons = { STALE_LEASE: "stale_lease", INVALID_STATE: "invalid_state", ALREADY_TERMINAL: "already_terminal", NOT_FOUND: "not_found" } as const;
  return { applied: false, reason: reasons[String(code) as keyof typeof reasons] ?? "invalid_state" };
}
