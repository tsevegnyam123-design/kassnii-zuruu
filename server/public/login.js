let token=null;let isAdmin=false;const $=id=>document.getElementById(id);
const fields=[['Овог','surname'],['Нэр','given_name'],['Ажилтны код','employee_code'],['Албан тушаал','job_title'],['Салбарын код','branch_code'],['Ажилд орсон огноо','start_date','date'],['Ажилтны төлөв','status'],['Ажлын төрөл','employment_type'],['Утас','phone','tel'],['И-мэйл','contact_email','email'],['Онцгой үед холбогдох хүн','emergency_contact'],['Онцгой үед холбогдох утас','emergency_phone','tel'],['Хаяг','address'],['Боловсрол','education'],['Сургалтын төлөв','training_status'],['Тэмдэглэл','notes']];
for(const [label,name,type] of fields){const el=document.createElement('label');el.textContent=label;const input=document.createElement('input');input.name=name;input.type=type||'text';input.autocomplete='off';input.maxLength=300;input.disabled=true;el.append(input);$('profileFields').append(el);}
$('clearProfile').addEventListener('click',()=>{$('profileForm').reset();});
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{const tab=button.dataset.tab;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===button));document.querySelectorAll('.section').forEach(s=>s.classList.toggle('active',s.id===tab));}));
$('loginForm').addEventListener('submit',async event=>{event.preventDefault();$('message').textContent='Нэвтэрч байна…';$('message').className='message';$('submit').disabled=true;try{const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('email').value,password:$('password').value}),cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Нэвтрэх боломжгүй');token=data.access_token;$('password').value='';const meResponse=await fetch('/api/me',{headers:{Authorization:'Bearer '+token},cache:'no-store'});const me=await meResponse.json();if(!meResponse.ok)throw Error(me.error||'Мэдээлэл ачаалж чадсангүй');isAdmin=me.role==='hr_admin';const name=me.profile?.given_name||'Туршилтын хэрэглэгч';$('account').textContent=name+' · Эрх: '+(me.role||'employee');$('who').textContent=name;$('roleLabel').textContent=me.role==='hr_admin'?'HR админ':'Ажилтан';$('admin').hidden=me.role!=='hr_admin';$('loginView').classList.add('hidden');$('portal').classList.remove('hidden');await loadProfile();if(isAdmin)await loadEmployees();}catch(err){token=null;$('message').className='message error';$('message').textContent=err.message||'Алдаа гарлаа';}finally{$('submit').disabled=false;}});
$('logout').addEventListener('click',()=>{token=null;isAdmin=false;$('profileForm').reset();$('saveProfile').disabled=true;$('hrEmployeeCard').classList.add('hidden');$('portal').classList.add('hidden');$('loginView').classList.remove('hidden');$('who').textContent='Туршилтын орчин';$('message').textContent='Гарлаа';$('message').className='message success';});
$('branchSearch').addEventListener('input',()=>{$('branchResult').textContent='Салбарын баталгаатай жагсаалт холбогдоогүй тул хайлтын үр дүн байхгүй.';});

async function loadProfile(){
  $('profileStatus').textContent='Supabase анкет ачаалж байна…';
  const response=await fetch('/api/profile',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
  const result=await response.json();
  if(!response.ok){$('profileStatus').textContent=result.error||'Анкет ачаалж чадсангүй';return;}
  $('profileForm').reset();
  if(result.profile) for(const [key,value] of Object.entries(result.profile)){const input=$('profileForm').elements.namedItem(key);if(input)input.value=value??'';}
  const hrFields=['employee_code','job_title','branch_code','start_date','status','employment_type','training_status'];
  for(const input of $('profileForm').querySelectorAll('input'))input.disabled=!isAdmin && (hrFields.includes(input.name)||!result.profile);
  $('saveProfile').disabled=!isAdmin&&!result.profile;
  $('profileStatus').textContent=result.profile?'Анкет Supabase-аас ачааллаа. Зөвшөөрөгдсөн талбаруудаа засаж хадгална.':isAdmin?'Анкет байхгүй. HR админ шинэ анкет үүсгэж болно. Код, овог, нэрийг заавал бөглөнө.':'Анхны анкетыг HR админ үүсгэх шаардлагатай.';
}
$('saveProfile').addEventListener('click',async()=>{
  if(!token)return;
  $('saveProfile').disabled=true;$('profileStatus').textContent='Хадгалж байна…';
  try{
    const payload={};
    for(const input of $('profileForm').querySelectorAll('input'))if(!input.disabled)payload[input.name]=input.value.trim()||null;
    const response=await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(payload),cache:'no-store'});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Хадгалж чадсангүй');
    $('profileStatus').textContent='Анкет Supabase-д хадгалагдлаа.';
    await loadProfile();
    if(isAdmin)await loadEmployees();
  }catch(err){$('profileStatus').textContent=err.message;}finally{$('saveProfile').disabled=false;}
});
async function loadEmployees(){
  $('hrEmployeeCard').classList.remove('hidden');
  try{
    const response=await fetch('/api/admin/employees',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Ажилтны жагсаалт ачаалж чадсангүй');
    $('hrEmployeeStatus').textContent='Эхний '+result.employees.length+' ажилтны хязгаарлагдмал жагсаалт (дээд тал нь 100).';
    const table=document.createElement('table');const head=document.createElement('thead');const row=document.createElement('tr');
    for(const title of ['Код','Овог','Нэр','Албан тушаал']){const th=document.createElement('th');th.textContent=title;row.append(th);}head.append(row);table.append(head);
    const body=document.createElement('tbody');
    for(const employee of result.employees){const tr=document.createElement('tr');for(const key of ['employee_code','surname','given_name','job_title']){const td=document.createElement('td');td.textContent=employee[key]??'—';tr.append(td);}body.append(tr);}table.append(body);$('hrEmployeeList').replaceChildren(table);
  }catch(err){$('hrEmployeeStatus').textContent=err.message;}
}
