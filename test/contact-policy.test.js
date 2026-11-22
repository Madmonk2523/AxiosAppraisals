const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../assets/contact-policy');
const html = fs.readFileSync(path.join(__dirname,'../contact.html'),'utf8');
test('native blacklist exactly matches shared policy and stays within vendor guidance',()=>{
 const value=html.match(/name="_blacklist" value="([^"]+)"/)[1];
 assert.deepEqual(value.split(','),policy.phrases);assert.ok(policy.phrases.length<=20);
 assert.ok(!/name="_captcha"[^>]+value="false"/.test(html));
 assert.match(html,/name="_honey"/);assert.match(html,/href="tel:\+19173457227"/);
 assert.ok(html.indexOf('assets/contact-policy.js')<html.indexOf('assets/contact-form.js'));
});
test('browser policy export has the same normalized matching without blocking ordinary links',()=>{
 const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/contact-policy.js'),'utf8'),{window});
 assert.equal(window.AxiosContactPolicy.hasBlockedContent({message:'AI research teams are licensing de–identified business data'}),true);
 assert.equal(window.AxiosContactPolicy.hasBlockedContent({message:'Please see https://example.com/report for appraisal data.'}),false);
 // Vendor configuration and verification tokens are not user-facing inquiry content.
 assert.equal(policy.hasBlockedContent({_blacklist:policy.phrases.join(','),token:policy.phrases[0]}),false);
});
