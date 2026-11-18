(() => {
  const form = document.getElementById('contact-form');
  if (!form) return;
  const status = document.getElementById('form-status');
  const button = form.querySelector('button[type="submit"]');
  let mode = null, token = '', widget, busy = false;
  const say = (text, type = 'error') => { status.textContent = text; status.className = `form-status ${type}`; };
  const reset = () => { token = ''; if (window.turnstile && widget !== undefined) window.turnstile.reset(widget); };
  form.addEventListener('submit', async event => {
    if (mode !== 'formsubmit') event.preventDefault();
    if (busy) { event.preventDefault(); return; }
    if (!mode) { say('The form is unavailable. Please call (917) 345-7227.'); return; }
    if (form.elements._honey.value || !form.reportValidity()) { event.preventDefault(); return; }
    if (mode === 'formsubmit') {
      form.elements._subject.value = `[Axios Website Inquiry] ${form.elements.matter.value}`;
      say('Continue to the verification page to send your inquiry.', 'success');
      return;
    }
    if (!token) { say('Please complete the verification first.'); return; }
    busy = true; button.disabled = true;
    say('Sending your inquiry…', 'success');
    const payload = {};
    ['name','email','phone','matter','address','message','_honey'].forEach(key => { payload[key] = form.elements[key].value; });
    payload.token = token;
    try {
      const response = await fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.error || 'We could not confirm delivery. Please call (917) 345-7227 before retrying.');
      form.reset(); say('Your inquiry was sent. The Axios team will follow up using your contact details.','success');
    } catch (error) { say(error.name === 'Error' ? error.message : 'We could not confirm delivery. Please call (917) 345-7227 before retrying.'); }
    finally { reset(); busy = false; button.disabled = false; }
  });
  fetch('/api/contact',{cache:'no-store',signal:AbortSignal.timeout(8000)})
    .then(async response => { if (!response.ok) throw Error(); return response.json(); })
    .then(config => {
      if (config.mode === 'formsubmit') {
        mode = 'formsubmit'; form.action = 'https://formsubmit.co/j.xir@axiosappraisals.com'; button.disabled = false; say('You will complete a spam check on the next page.',''); return;
      }
      if (config.mode !== 'protected' || !config.siteKey || config.action !== 'axios_inquiry') throw Error();
      mode = 'protected'; form.action = '/api/contact';
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => {
        try {
          widget = window.turnstile.render('#turnstile-container',{sitekey:config.siteKey,action:config.action,callback:value => { token=value; },'expired-callback':() => { token=''; say('Verification expired. Please verify again.'); },'error-callback':() => { token=''; say('Verification is unavailable. Please call (917) 345-7227.'); }});
          button.disabled = false; say('Please complete the verification before sending.','');
        } catch { say('Verification is unavailable. Please call (917) 345-7227.'); }
      };
      script.onerror = () => say('Verification could not load. Please call (917) 345-7227.');
      document.head.appendChild(script);
    }).catch(() => say('Online inquiries are temporarily unavailable. Please call (917) 345-7227.'));
})();
