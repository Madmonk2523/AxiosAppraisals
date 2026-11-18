const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const code=fs.readFileSync(require('node:path').join(__dirname,'../assets/contact-form.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function boot(config={mode:'formsubmit'},options={}) {
  const elements=Object.fromEntries(['name','email','phone','matter','address','message','_honey','_subject'].map(k=>[k,{value:k==='_honey'?'':k}]));
  const button={disabled:true},status={},calls=[];let submit,widgetOptions,resets=0,formResets=0;
  const form={elements,action:'/api/contact',querySelector:()=>button,addEventListener:(name,fn)=>{submit=fn;},reportValidity:()=>options.valid!==false,reset:()=>{formResets++;}};
  const document={getElementById:id=>id==='contact-form'?form:status,createElement:()=>({}),head:{appendChild:script=>{if(options.scriptFail)script.onerror();else script.onload();}}};
  const window={turnstile:{render:(selector,value)=>{widgetOptions=value;return 'widget';},reset:()=>{resets++;}}};
  const fetch=async(url,init)=>{calls.push({url,init});if(calls.length===1){if(options.configFail)throw Error();return {ok:true,json:async()=>config};}return options.send ? options.send() : {ok:true,json:async()=>({ok:true})};};
  vm.runInNewContext(code,{document,window,fetch,AbortSignal,Error}); await tick();
  return {form,button,status,calls,get widgetOptions(){return widgetOptions;},get resets(){return resets;},get formResets(){return formResets;},submit:async()=>{const event={prevented:false,preventDefault(){this.prevented=true;}};await submit(event);return event;}};
}
test('default mode enables native CAPTCHA vendor submission and distinctive subject',async()=>{
 const app=await boot();assert.equal(app.button.disabled,false);assert.match(app.form.action,/^https:\/\/formsubmit.co\//);const event=await app.submit();assert.equal(event.prevented,false);assert.equal(app.calls.length,1);assert.match(app.form.elements._subject.value,/\[Axios Website Inquiry\]/);
});
test('failed configuration never downgrades or permits submission',async()=>{
 for(const options of [{configFail:true},{}]){const app=await boot({mode:'unknown'},options);assert.equal(app.button.disabled,true);assert.equal(app.form.action,'/api/contact');assert.equal((await app.submit()).prevented,true);assert.equal(app.calls.length,1);}
});
test('protected mode waits for challenge and posts only to API',async()=>{
 const app=await boot({mode:'protected',siteKey:'key',action:'axios_inquiry'});assert.equal((await app.submit()).prevented,true);assert.equal(app.calls.length,1);app.widgetOptions.callback('token');await app.submit();assert.equal(app.calls.length,2);assert.equal(app.calls[1].url,'/api/contact');assert.equal(app.formResets,1);assert.equal(app.resets,1);assert.equal(app.form.action,'/api/contact');
});
test('API rejection never uses fallback or reports success and resets verification',async()=>{
 const app=await boot({mode:'protected',siteKey:'key',action:'axios_inquiry'},{send:async()=>({ok:false,json:async()=>({error:'Verification failed.'})})});app.widgetOptions.callback('token');await app.submit();assert.match(app.status.textContent,/Verification failed/);assert.equal(app.form.action,'/api/contact');assert.equal(app.formResets,0);assert.equal(app.resets,1);await app.submit();assert.equal(app.calls.length,2);
});
test('challenge script failure keeps protected form disabled',async()=>{
 const app=await boot({mode:'protected',siteKey:'key',action:'axios_inquiry'},{scriptFail:true});assert.equal(app.button.disabled,true);assert.match(app.status.textContent,/Please call/);assert.equal(app.form.action,'/api/contact');
});
test('double clicks during an API request send once; expiration removes token',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);const app=await boot({mode:'protected',siteKey:'key',action:'axios_inquiry'},{send:()=>pending});app.widgetOptions.callback('token');const one=app.submit();await tick();await app.submit();assert.equal(app.calls.length,2);finish({ok:true,json:async()=>({ok:true})});await one;app.widgetOptions.callback('new');app.widgetOptions['expired-callback']();await app.submit();assert.equal(app.calls.length,2);
});
test('invalid fields and honey prevent even fallback submissions',async()=>{
 const app=await boot();app.form.elements._honey.value='spam';assert.equal((await app.submit()).prevented,true);
 const invalid=await boot({mode:'formsubmit'},{valid:false});assert.equal((await invalid.submit()).prevented,true);
});
