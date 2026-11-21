/* Run the real lookup controller without sending email or contacting a service. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../frontend/static/js/guest-lookup.js'),'utf8');
const order='12345678-abcd-4567-8901-123456789abc';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function fixture({id=order,email='review@example.com',responseStatus=200,message='Generic acknowledgement',reject=false,badJson=false,wait=false}={}){
 const nodes=new Map(),calls=[];let active=null,resolve;
 const pending=new Promise(r=>{resolve=r;});
 function node(name){
  if(!nodes.has(name))nodes.set(name,{id:name,disabled:true,hidden:false,readOnly:false,textContent:'',dataset:{},value:'',attributes:{},listeners:{},
   addEventListener(type,callback){this.listeners[type]=callback;},
   setAttribute(key,value){this.attributes[key]=value;},hasAttribute(key){return key in this.attributes;},
   querySelector(){return node('submit-label');},focus(){active=this.id;},
  });
  return nodes.get(name);
 }
 const form=node('guest-order-lookup'),idField=node('lookup-order-id'),emailField=node('lookup-email');
 idField.value=id;emailField.value=email;
 Object.defineProperty(idField,'validity',{get:()=>({valid:uuid.test(idField.value)})});
 Object.defineProperty(emailField,'validity',{get:()=>({valid:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.value)})});
 form.reportValidity=()=>{const invalid=[idField,emailField].filter(f=>!f.validity.valid);for(const field of invalid)form.listeners.invalid({target:field});if(invalid[0])invalid[0].focus();return !invalid.length;};
 vm.runInNewContext(source,{document:{getElementById:node},fetch:async(path,options)=>{
  calls.push({path,options,payload:JSON.parse(options.body)});
  if(wait)await pending;
  if(reject)throw Error('Network unavailable');
  return {status:responseStatus,ok:responseStatus<400,json:async()=>{if(badJson)throw Error('Invalid JSON');return {message};}};
 }});
 return {node,calls,resolve,active:()=>active,send:()=>form.listeners.submit({preventDefault(){}}),edit:()=>node('guest-lookup-edit').listeners.click(),input:field=>form.listeners.input({target:field})};
}

(async()=>{
 const bad=fixture({id:'12345678',email:'invalid'});await bad.send();
 assert.equal(bad.calls.length,0,'Invalid details must not request email');
 assert.equal(bad.active(),'lookup-order-id');
 assert.match(bad.node('lookup-order-id-error').textContent,/36-character/);
 assert.match(bad.node('lookup-email-error').textContent,/valid checkout email/);
 bad.node('lookup-order-id').value=order;bad.input(bad.node('lookup-order-id'));
 assert.equal(bad.node('lookup-order-id-error').textContent,'');

 const success=fixture({id:'  # '+order.toUpperCase()+'  ',email:' REVIEW@EXAMPLE.COM ',wait:true,message:'Private server detail must not appear'});
 const first=success.send(),duplicate=success.send();
 assert.equal(success.calls.length,1,'Repeated submits must create one request');
 assert.equal(success.node('guest-lookup-fields').disabled,true);
 assert.equal(success.node('guest-lookup-submit').attributes['aria-busy'],'true');
 success.resolve();await Promise.all([first,duplicate]);
 assert.deepEqual(success.calls[0].payload,{order_id:order,email:'review@example.com'});
 assert.equal(success.calls[0].path,'/api/guest/order-link');
 assert.equal(success.calls[0].options.method,'POST');
 assert.equal(success.calls[0].options.credentials,'same-origin');
 assert.equal(success.node('guest-lookup-feedback').dataset.state,'success');
 assert.match(success.node('guest-lookup-feedback').textContent,/If the order ID and checkout email match/);
 assert.doesNotMatch(success.node('guest-lookup-feedback').textContent,/Private server detail/);
 assert.equal(success.node('lookup-order-id').readOnly,true);
 assert.equal(success.node('guest-lookup-submit').hidden,true);
 assert.equal(success.active(),'guest-lookup-result-title');
 await success.send();assert.equal(success.calls.length,1,'Success cannot accidentally send another email');
 success.edit();assert.equal(success.node('guest-lookup-submit').hidden,false);
 assert.equal(success.node('lookup-order-id').readOnly,false);
 assert.equal(success.node('lookup-order-id').value,order);
 assert.equal(success.active(),'lookup-order-id');

 for(const options of [{responseStatus:429},{responseStatus:403},{responseStatus:503},{reject:true},{badJson:true}]){
  const f=fixture(options);await f.send();
  assert.equal(f.node('guest-lookup-feedback').dataset.state,'error');
  assert.equal(f.node('guest-lookup-fields').disabled,false);
  assert.equal(f.node('guest-lookup-submit').disabled,false);
  assert.equal(f.node('lookup-email').value,'review@example.com');
  assert.equal(f.node('guest-lookup-result-title').hidden,true);
  assert.match(f.node('guest-lookup-feedback').textContent,options.responseStatus===429?/Too many requests/:options.responseStatus===403?/refresh this page/:/try again/);
 }
 const match=fixture({message:'If this paid guest order matches your email, a secure link will be sent.'});
 const missing=fixture({message:'Different server response'});await match.send();await missing.send();
 assert.equal(match.node('guest-lookup-feedback').textContent,missing.node('guest-lookup-feedback').textContent,'Acknowledgements must not reveal whether an order matched');
 console.log('Guest lookup interactions passed: validation, normalization, duplicate requests, private acknowledgement, errors and editing.');
})().catch(error=>{console.error(error);process.exitCode=1;});
