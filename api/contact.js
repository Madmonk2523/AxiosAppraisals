const { createHmac, randomUUID } = require('node:crypto');
const { isIP } = require('node:net');
const { hasBlockedContent } = require('../assets/contact-policy');
const MAX_BYTES = 8192;
const MATTERS = ['Estate / Probate', 'Divorce / Family Law', 'IRS / Tax Filing', 'Litigation / Expert Support', 'Private Property', 'Not sure'];
const RECIPIENT = 'j.xir@axiosappraisals.com';
const ACTION = 'axios_inquiry';
const LIMIT_SCRIPT = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
function config(env) {
  const mode = env.CONTACT_FORM_MODE || 'formsubmit';
  if (mode === 'formsubmit') return { mode };
  if (mode !== 'protected') throw Error('configuration');
  const origins = (env.CONTACT_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origins.length || origins.some(o => { try { const u = new URL(o); return u.protocol !== 'https:' || u.origin !== o; } catch { return true; } })) throw Error('configuration');
  const required = ['TURNSTILE_SITE_KEY','TURNSTILE_SECRET_KEY','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','CONTACT_RATE_LIMIT_SECRET','RESEND_API_KEY','CONTACT_FROM_EMAIL'];
  if (required.some(k => !env[k]) || env.CONTACT_RATE_LIMIT_SECRET.length < 32 || env.CONTACT_SENDER_VERIFIED !== 'true') throw Error('configuration');
  // Do not accept arbitrary endpoints or test sender domains in production configuration.
  const redis = new URL(env.UPSTASH_REDIS_REST_URL);
  if (redis.protocol !== 'https:' || !redis.hostname.endsWith('.upstash.io') || redis.username || redis.password || redis.search || redis.hash) throw Error('configuration');
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.CONTACT_FROM_EMAIL) || /@resend\.dev$/i.test(env.CONTACT_FROM_EMAIL)) throw Error('configuration');
  return { mode, origins, hosts: origins.map(o => new URL(o).hostname), siteKey: env.TURNSTILE_SITE_KEY };
}
function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('validation');
  const bounds = { name:80, email:120, phone:20, matter:40, address:200, message:1200, _honey:200, token:2048 };
  const result = {};
  for (const [key,max] of Object.entries(bounds)) {
    const value = body[key] === undefined ? '' : body[key];
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw Error('validation');
    if (key !== 'message' && /[\r\n]/.test(value)) throw Error('validation');
    result[key] = value.trim();
  }
  if (!result.name || !MATTERS.includes(result.matter) || !/^[+()\d .-]+$/.test(result.phone) || result.phone.replace(/\D/g,'').length < 7 || result.phone.replace(/\D/g,'').length > 15) throw Error('validation');
  if (result.email && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(result.email)) throw Error('validation');
  if (hasBlockedContent(body)) throw Error('validation');
  if (result._honey || !result.token) throw Error('validation');
  return result;
}
async function readBody(req) {
  if (Number(req.headers['content-length']) > MAX_BYTES) throw Error('size');
  if (req.body !== undefined) {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > MAX_BYTES) throw Error('size');
    return typeof req.body === 'string' ? JSON.parse(raw) : req.body;
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > MAX_BYTES) throw Error('size'); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function createHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  async function request(url, options) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(7000), redirect:'error' });
    if (!response.ok) throw Error('provider');
    return response.json();
  }
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    const reply = (code,error) => res.status(code).json(error ? {error} : {ok:true});
    if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow','GET, POST'); return reply(405,'Method not allowed.'); }
    let cfg;
    try { cfg = config(env); } catch { return reply(503,'Online inquiries are unavailable. Please call (917) 345-7227.'); }
    if (req.method === 'GET') return res.status(200).json({mode:cfg.mode, ...(cfg.mode === 'protected' ? {siteKey:cfg.siteKey,action:ACTION}: {})});
    if (cfg.mode !== 'protected') return reply(503,'Online inquiries are not enabled here. Please use the contact page.');
    if (!cfg.origins.includes(req.headers.origin)) return reply(403,'Request not permitted.');
    if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return reply(415,'JSON required.');
    let data;
    try { data = validate(await readBody(req)); } catch(e) { return reply(e.message === 'size' ? 413 : 400,'Please check the form and verification, then try again.'); }
    // Vercel overwrites x-vercel-forwarded-for. Never trust caller-controlled x-forwarded-for.
    const ip = (req.headers['x-vercel-forwarded-for'] || '').trim();
    if (!isIP(ip)) return reply(503,'Unable to verify this request. Please call (917) 345-7227.');
    try {
      const digest = createHmac('sha256',env.CONTACT_RATE_LIMIT_SECRET).update(ip).digest('hex');
      const count = await request(env.UPSTASH_REDIS_REST_URL,{method:'POST',headers:{Authorization:`Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(['EVAL',LIMIT_SCRIPT,'1',`axios:contact:ip:${digest}`,'900'])});
      if (!Number.isSafeInteger(count.result) || count.result < 1) throw Error('provider');
      if (count.result > 5) { res.setHeader('Retry-After','900'); return reply(429,'Too many attempts. Please wait 15 minutes or call (917) 345-7227.'); }
      const verification = await request('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:data.token,remoteip:ip})});
      if (verification.success !== true || !cfg.hosts.includes(verification.hostname) || verification.action !== ACTION) return reply(400,'Verification failed or expired. Please complete a fresh verification.');
      // Reserve tokens in shared storage as well: Cloudflare replay detection can converge asynchronously.
      const tokenDigest = createHmac('sha256',env.CONTACT_RATE_LIMIT_SECRET).update(data.token).digest('hex');
      const reservation = await request(env.UPSTASH_REDIS_REST_URL,{method:'POST',headers:{Authorization:`Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(['SET',`axios:contact:token:${tokenDigest}`,'1','NX','EX','600'])});
      if (reservation.result === null) return reply(409,'This verification has already been used. Please complete a fresh verification.');
      if (reservation.result !== 'OK') throw Error('provider');
      const id = randomUUID();
      const mail = {from:env.CONTACT_FROM_EMAIL,to:[RECIPIENT],subject:`[Axios Website Inquiry] ${data.matter}`,text:`Website inquiry: ${id}\nMatter: ${data.matter}\nName: ${data.name}\nPhone: ${data.phone}\nEmail: ${data.email || 'Not provided'}\nProperty: ${data.address || 'Not provided'}\n\n${data.message || 'No additional message.'}`, ...(data.email ? {reply_to:data.email}: {})};
      const sent = await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`axios-inquiry-${id}`},body:JSON.stringify(mail)});
      if (typeof sent.id !== 'string' || !sent.id) throw Error('provider');
      return reply(200);
    } catch { return reply(503,'We could not confirm delivery. Please call (917) 345-7227 before retrying.'); }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.config = { api: { bodyParser: false } };
