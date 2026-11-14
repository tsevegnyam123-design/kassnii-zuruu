let token=null;
const $=id=>document.getElementById(id);
$('loginForm').addEventListener('submit',async event=>{
event.preventDefault();$('message').textContent='Нэвтэрч байна…';$('message').className='';$('submit').disabled=true;
try{
const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('email').value,password:$('password').value}),cache:'no-store'});
const data=await response.json();if(!response.ok)throw Error(data.error||'Нэвтрэх боломжгүй');
token=data.access_token;$('password').value='';
const meResponse=await fetch('/api/me',{headers:{Authorization:'Bearer '+token},cache:'no-store'});const me=await meResponse.json();
if(!meResponse.ok)throw Error(me.error||'Мэдээлэл ачаалж чадсангүй');
$('account').textContent=(me.profile?.given_name||'Туршилтын хэрэглэгч')+' · Эрх: '+(me.role||'employee');
$('admin').classList.toggle('hidden',me.role!=='hr_admin');$('loginView').classList.add('hidden');$('accountView').classList.remove('hidden');
}catch(err){token=null;$('message').className='error';$('message').textContent=err.message||'Алдаа гарлаа';}finally{$('submit').disabled=false;}
});
$('logout').addEventListener('click',()=>{token=null;$('accountView').classList.add('hidden');$('loginView').classList.remove('hidden');$('message').textContent='Гарлаа';$('message').className='success';});
