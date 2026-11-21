/* Exercise clipboard feedback without using the system clipboard. */
'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../frontend/static/js/order-detail.js'),'utf8');
function fixture(writeText){
 const status={textContent:'',dataset:{}},target={textContent:'  12345678-abcd-4567-8901-123456789abc  '};
 const button={hidden:true,disabled:false,textContent:'Copy order ID',dataset:{copyTarget:'order-id',copyFeedback:'feedback',copyLabel:'Order ID'},addEventListener(event,fn){this.click=fn;}};
 vm.runInNewContext(source,{document:{getElementById(id){return id==='order-details'?{querySelectorAll:()=>[button]}:id==='order-id'?target:status;}},navigator:{clipboard:writeText?{writeText}:undefined}});
 return {button,status,target};
}
(async()=>{
 let finish;const pending=new Promise(r=>{finish=r;});const writes=[];
 const f=fixture(async value=>{writes.push(value);await pending;});
 assert.equal(f.button.hidden,false);
 const first=f.button.click(),duplicate=f.button.click();
 assert.equal(f.button.disabled,true);assert.equal(writes.length,1);
 assert.equal(writes[0],'12345678-abcd-4567-8901-123456789abc');
 finish();await Promise.all([first,duplicate]);
 assert.equal(f.status.textContent,'Order ID copied.');assert.equal(f.status.dataset.state,'success');
 assert.equal(f.button.disabled,false);assert.equal(f.button.textContent,'Copy order ID');
 for(const write of [undefined,async()=>{throw Error('Clipboard denied');}]){
  const blocked=fixture(write);await blocked.button.click();
  assert.equal(blocked.status.dataset.state,'error');assert.match(blocked.status.textContent,/copy it manually/);
  assert.equal(blocked.button.disabled,false);assert.equal(blocked.target.textContent.trim(),writes[0]);
 }
 let denied=true;const retry=fixture(async()=>{if(denied)throw Error('Denied');});
 await retry.button.click();denied=false;await retry.button.click();assert.equal(retry.status.dataset.state,'success');
 vm.runInNewContext(source,{document:{getElementById:()=>null}});
 console.log('Order detail interactions passed: copying, duplicate clicks, unavailable clipboard, denied permission and retry.');
})().catch(error=>{console.error(error);process.exitCode=1;});
