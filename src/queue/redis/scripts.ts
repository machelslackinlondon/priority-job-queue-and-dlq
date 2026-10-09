export const SUBMIT_SCRIPT = `
local existing = redis.call('GET', KEYS[3])
if existing then return {'DUPLICATE', existing} end
local outstanding = tonumber(redis.call('GET', KEYS[1]) or '0')
if outstanding >= tonumber(ARGV[1]) then return {'FULL', ''} end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('LPUSH', KEYS[4], ARGV[3])
redis.call('INCR', KEYS[1])
if ARGV[4] == '1' then
  redis.call('SET', KEYS[3], ARGV[3])
  redis.call('SET', KEYS[5], KEYS[3])
end
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
redis.call('SET', KEYS[1], cjson.encode(job)); redis.call('ZREM', KEYS[2], ARGV[3]); redis.call('DECR', KEYS[3]); redis.call('ZADD', KEYS[4], ARGV[2], ARGV[3])
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
redis.call('SET', KEYS[1], cjson.encode(job)); redis.call('ZREM', KEYS[2], ARGV[4]); redis.call('LPUSH', KEYS[3], ARGV[4]); redis.call('DECR', KEYS[4]); redis.call('ZADD', KEYS[5], ARGV[2], ARGV[4])
return 'APPLIED'
`;

export const RENEW_SCRIPT = `
local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
local job=cjson.decode(raw); if job.state~='running' or not job.lease or job.lease.token~=ARGV[1] then return 0 end
job.lease.expiresAt=tonumber(ARGV[2]); job.updatedAt=tonumber(ARGV[3]); redis.call('SET',KEYS[1],cjson.encode(job)); redis.call('ZADD',KEYS[2],ARGV[2],ARGV[4]); return 1
`;

export const PROMOTE_SCRIPT = `
local ids=redis.call('ZRANGEBYSCORE',KEYS[1],'-inf',ARGV[2],'LIMIT',0,tonumber(ARGV[3])); local count=0
for _,id in ipairs(ids) do
  if redis.call('ZREM',KEYS[1],id)==1 then
    local key=ARGV[1]..id; local raw=redis.call('GET',key)
    if raw then local job=cjson.decode(raw)
      if job.state=='retry_scheduled' and job.availableAt<=tonumber(ARGV[2]) then
        job.state='queued'; job.availableAt=nil; job.updatedAt=tonumber(ARGV[2]); redis.call('SET',key,cjson.encode(job))
        local index=5; if job.priority=='critical' then index=2 elseif job.priority=='high' then index=3 elseif job.priority=='normal' then index=4 end
        redis.call('LPUSH',KEYS[index],id); count=count+1
      end
    end
  end
end
return count
`;

export const RECOVER_SCRIPT = `
local ids=redis.call('ZRANGEBYSCORE',KEYS[1],'-inf',ARGV[2],'LIMIT',0,tonumber(ARGV[3])); local count=0
for _,id in ipairs(ids) do
  if redis.call('ZREM',KEYS[1],id)==1 then
    local key=ARGV[1]..id; local raw=redis.call('GET',key)
    if raw then local job=cjson.decode(raw)
      if job.state=='running' and job.lease and job.lease.expiresAt<=tonumber(ARGV[2]) then
        job.state='queued'; job.lease=nil; job.updatedAt=tonumber(ARGV[2]); redis.call('SET',key,cjson.encode(job))
        local index=5; if job.priority=='critical' then index=2 elseif job.priority=='high' then index=3 elseif job.priority=='normal' then index=4 end
        redis.call('LPUSH',KEYS[index],id); count=count+1
      end
    end
  end
end
return count
`;

export const PURGE_TERMINAL_SCRIPT = `
local cutoff=tonumber(ARGV[1])-tonumber(ARGV[2])
local ids=redis.call('ZRANGEBYSCORE',KEYS[1],'-inf',cutoff,'LIMIT',0,tonumber(ARGV[5])); local count=0
for _,id in ipairs(ids) do
  if redis.call('ZREM',KEYS[1],id)==1 then
    local reverseKey=ARGV[4]..id
    local idemKey=redis.call('GET',reverseKey)
    if idemKey and redis.call('GET',idemKey)==id then redis.call('DEL',idemKey) end
    redis.call('DEL',reverseKey)
    redis.call('DEL',ARGV[3]..id)
    redis.call('LREM',KEYS[2],0,id)
    count=count+1
  end
end
return count
`;

export function transitionResult(code: unknown): { applied: boolean; reason?: "stale_lease" | "invalid_state" | "already_terminal" | "not_found" } {
  if (code === "APPLIED") return { applied: true };
  const reasons = { STALE_LEASE: "stale_lease", INVALID_STATE: "invalid_state", ALREADY_TERMINAL: "already_terminal", NOT_FOUND: "not_found" } as const;
  return { applied: false, reason: reasons[String(code) as keyof typeof reasons] ?? "invalid_state" };
}
