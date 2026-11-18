const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHandler } = require('../api/contact');
const env = {CONTACT_FORM_MODE:'protected',CONTACT_ALLOWED_ORIGINS:'https://axiosappraisals.com,https://www.axiosappraisals.com',TURNSTILE_SITE_KEY:'site-key',TURNSTILE_SECRET_KEY:'secret-key',UPSTASH_REDIS_REST_URL:'https://test.upstash.io',UPSTASH_REDIS_REST_TOKEN:'redis-token',CONTACT_RATE_LIMIT_SECRET:'a'.repeat(32),RESEND_API_KEY:'resend-key',CONTACT_FROM_EMAIL:'inquiries@axiosappraisals.com',CONTACT_SENDER_VERIFIED:'true'};
const body = {name:'Example Client',phone:'(917) 555-0100',email:'example@example.com',matter:'Not sure',address:'',message:'Example inquiry',_honey:'',token:'valid-token'};
function provider(options={}) {
  const calls=[]; const tokens=new Set();
  const fetchImpl=async (url,init) => {
    const data=JSON.parse(init.body); calls.push({url,init,data});
    if (options.throwAt && url.includes(options.throwAt)) throw Error('provider secret should never leak');
    let result;
    if (url.includes('upstash')) {
      if (data[0]==='SET') { result={result:tokens.has(data[1])?null:'OK'}; tokens.add(data[1]); }
      else result={result:options.count ?? 1};
    } else if(url.includes('cloudflare')) result=options.verification || {success:true,hostname:'axiosappraisals.com',action:'axios_inquiry'};
    else result=options.sent || {id:'email-test-id'};
    return {ok:!options.httpFailure, json:async()=>result};
  }; return {fetchImpl,calls};
}
async function invoke(options={}) {
  const mock=options.mock || provider(options);
  const req=options.stream ? Readable.from(options.stream) : {};
  Object.assign(req,{method:options.method || 'POST',headers:{origin:'https://axiosappraisals.com','content-type':'application/json','x-vercel-forwarded-for':'203.0.113.10',...options.headers}});
  if(!options.stream) req.body=options.body === undefined ? body : options.body;
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(data){this.data=data;return this;}};
  await createHandler({env:options.env || env,fetchImpl:mock.fetchImpl})(req,res); return {...res,calls:mock.calls};
}
test('valid inquiry uses shared limiter, hostname/action verification, replay guard and fixed recipient',async()=>{
  const r=await invoke(); assert.equal(r.code,200); assert.deepEqual(r.data,{ok:true}); assert.equal(r.calls.length,4);
  assert.equal(r.calls[0].data[0],'EVAL'); assert.ok(!r.calls[0].init.body.includes('203.0.113.10'));
  assert.equal(r.calls[2].data[0],'SET'); const mail=r.calls[3].data;
  assert.deepEqual(mail.to,['j.xir@axiosappraisals.com']); assert.equal(mail.from,env.CONTACT_FROM_EMAIL); assert.equal(mail.reply_to,body.email); assert.match(mail.subject,/^\[Axios Website Inquiry\] Not sure$/);
  assert.ok(!mail.text.includes(body.token)); assert.equal(r.headers['Cache-Control'],'no-store');
});
test('default GET explicitly selects vendor fallback, POST cannot send',async()=>{
  const get=await invoke({method:'GET',env:{}}); assert.deepEqual(get.data,{mode:'formsubmit'}); assert.equal(get.calls.length,0);
  const post=await invoke({env:{}}); assert.equal(post.code,503); assert.equal(post.calls.length,0);
});
test('missing keys or unverified sender fails closed without returning fallback',async()=>{
  for(const key of Object.keys(env).filter(k=>k!=='CONTACT_FORM_MODE')) {
    const bad={...env};delete bad[key]; const r=await invoke({env:bad,method:'GET'});assert.equal(r.code,503,key);assert.equal(r.data.mode,undefined);
  }
  assert.equal((await invoke({env:{CONTACT_FORM_MODE:'typo'}})).code,503);
});
test('method, origin, content type and missing trusted IP rejected',async()=>{
  for(const [options,code] of [[{method:'PUT'},405],[{headers:{origin:'https://evil.example'}},403],[{headers:{'content-type':'text/plain'}},415],[{headers:{'x-vercel-forwarded-for':'','x-forwarded-for':'203.0.113.10'}},503]]) {
    const r=await invoke(options);assert.equal(r.code,code);assert.equal(r.calls.length,0);
  }
});
test('validation rejects missing matter, honey, token, header injection and invalid types',async()=>{
  for(const change of [{matter:''},{matter:'other'},{_honey:'spam'},{token:''},{name:'a'.repeat(81)},{email:'a@example.com\r\nBcc:b@example.com'},{phone:'123'},{message:{}},{token:'a'.repeat(2049)},{name:'a\u0000b'}]) {
    const r=await invoke({body:{...body,...change}});assert.equal(r.code,400);assert.equal(r.calls.length,0);
  }
  for(const value of [null,[],123,'{not json']) assert.equal((await invoke({body:value})).code,400);
});
test('payload limit covers announced, parsed and streamed sizes',async()=>{
  assert.equal((await invoke({headers:{'content-length':'9000'}})).code,413);
  assert.equal((await invoke({body:{...body,extra:'x'.repeat(9000)}})).code,413);
  assert.equal((await invoke({stream:['x'.repeat(9000)]})).code,413);
  assert.equal((await invoke({stream:[JSON.stringify(body)]})).code,200);
});
test('rate limit prevents verification/email; shared-store failure fails closed',async()=>{
  const r=await invoke({count:6}); assert.equal(r.code,429);assert.equal(r.calls.length,1);assert.equal(r.headers['Retry-After'],'900');
  for(const options of [{throwAt:'upstash'},{count:'1'},{count:0},{httpFailure:true}]) assert.equal((await invoke(options)).code,503);
});
test('invalid, expired, reused, wrong-host or wrong-action tokens never send',async()=>{
  for(const verification of [{success:false,'error-codes':['timeout-or-duplicate']},{success:true,hostname:'evil.example',action:'axios_inquiry'},{success:true,hostname:'axiosappraisals.com',action:'other'},{}]) {
    const r=await invoke({verification});assert.equal(r.code,400);assert.equal(r.calls.length,2);
  }
  const mock=provider();assert.equal((await invoke({mock})).code,200);assert.equal((await invoke({mock})).code,409);
  assert.equal(mock.calls.filter(c=>c.url.includes('resend')).length,1);
});
test('provider failure does not report success or leak provider secrets',async()=>{
  for(const options of [{throwAt:'cloudflare'},{throwAt:'resend'},{sent:{}}]) {
    const r=await invoke(options);assert.equal(r.code,503);assert.ok(!JSON.stringify(r.data).includes('secret'));
  }
});
test('optional email omitted, body cannot override recipient or subject',async()=>{
  const r=await invoke({body:{...body,email:'',to:'attacker@example.com',subject:'bad'}});assert.equal(r.code,200);const mail=r.calls.at(-1).data;assert.equal(mail.reply_to,undefined);assert.deepEqual(mail.to,['j.xir@axiosappraisals.com']);assert.notEqual(mail.subject,'bad');
});
