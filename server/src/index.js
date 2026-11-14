import { randomBytes, createHash } from 'node:crypto';
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ALLOWED_ORIGINS'];
for (const key of required) if (!process.env[key]) throw new Error('Missing server configuration: ' + key);
const supabaseUrl = new URL(process.env.SUPABASE_URL).origin;
if (new URL(process.env.SUPABASE_URL).pathname !== '/') console.warn('SUPABASE_URL contained a path; normalized to project origin');
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin(origin, cb) { if (!origin || allowedOrigins.includes(origin)) return cb(null, true); cb(null, false); }, credentials: false }));
// Same-origin browser requests do not require CORS. Only explicitly allowed cross-origin sites receive CORS headers.
app.use((req,res,next) => { const origin=req.get('origin'); if (origin && new URL(origin).host !== req.get('host') && !allowedOrigins.includes(origin)) return res.status(403).json({error:'Origin not allowed'}); next(); });
app.use(express.json({ limit: '16kb' }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false }));
const publicIndex = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/index.html');
app.get('/', (_req,res) => res.sendFile(publicIndex));
app.get('/login.js', (_req,res) => res.sendFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/login.js')));

const resetIndex = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/reset.html');
app.get('/reset-password', (_req,res) => res.sendFile(resetIndex));
app.get('/reset.js', (_req,res) => res.sendFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/reset.js')));
const recoveryLimit = rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:'draft-7',legacyHeaders:false});
app.post('/api/recovery/request', recoveryLimit, async (req,res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'И-мэйл хаягаа шалгана уу'});
  const redirectTo = 'https://gs25-employee-portal-git-feature-portal-ui-v2-gs-portal.vercel.app/reset-password';
  const {error} = await supabase.auth.resetPasswordForEmail(email,{redirectTo});
  if(error) { console.error('Recovery request failed:',JSON.stringify({status:error.status,code:error.code,message:error.message,projectHost:new URL(supabaseUrl).host})); return res.status(502).json({error:'Supabase сэргээх хүсэлтийг хүлээж авсангүй. Серверийн тохиргоог шалгах шаардлагатай.'}); }
  res.set('Cache-Control','no-store');
  res.json({message:'Хэрэв энэ и-мэйл бүртгэлтэй бол сэргээх холбоос илгээгдэнэ.'});
});
app.post('/api/recovery/complete', recoveryLimit, async (req,res) => {
  const {access_token,password}=req.body||{};
  if(typeof access_token!=='string'||access_token.length>4096||typeof password!=='string'||password.length<12||password.length>128) return res.status(400).json({error:'Холбоос эсвэл нууц үг тохирохгүй байна (хамгийн багадаа 12 тэмдэгт)'});
  const {data,error}=await supabase.auth.getUser(access_token);
  if(error||!data?.user) return res.status(401).json({error:'Сэргээх холбоос хүчингүй эсвэл хугацаа дууссан'});
  // Use the user's own session, not the admin API, to update their password.
  const response=await fetch(supabaseUrl+'/auth/v1/user',{method:'PUT',headers:{'Content-Type':'application/json',apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+access_token},body:JSON.stringify({password})});
  res.set('Cache-Control','no-store');
  if(!response.ok) return res.status(400).json({error:'Нууц үг шинэчилж чадсангүй. Шинэ холбоос аваад дахин оролдоно уу'});
  res.json({message:'Нууц үг шинэчлэгдлээ. Одоо нэвтэрч болно.'});
});
app.get('/api/health', (_req,res) => res.json({ status: 'ok' }));
// Initial login uses the Supabase Auth email/password configured for the admin.
// Employee-code login is not enabled until a verified code-to-auth mapping exists.
app.post('/api/login', rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-7',legacyHeaders:false}), async (req,res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 1024 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'Valid email and password required'});
  const client = createClient(supabaseUrl,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error} = await client.auth.signInWithPassword({email,password});
  res.set('Cache-Control','no-store');
  if(error || !data?.session?.access_token) return res.status(401).json({error:'Invalid email or password'});
  res.json({access_token:data.session.access_token,expires_in:data.session.expires_in});
});
async function authenticate(req,res,next) {
  const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!match) return res.status(401).json({ error: 'Authentication required' });
  const { data, error } = await supabase.auth.getUser(match[1]);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid session' });
  req.user = data.user;
  next();
}
app.get('/api/me', authenticate, async (req,res) => {
  const [{data:role,error:roleError},{data:profile,error:profileError}] = await Promise.all([
    supabase.from('portal_roles').select('role').eq('auth_user_id',req.user.id).maybeSingle(),
    supabase.from('employee_profiles').select('employee_code,given_name,surname,job_title,branch_id').eq('auth_user_id',req.user.id).maybeSingle()
  ]);
  if (roleError || profileError) return res.status(500).json({ error: 'Unable to load account' });
  res.set('Cache-Control','no-store');
  res.json({ role: role?.role || 'employee', profile: profile || null });
});
app.get('/api/admin/status', authenticate, async (req,res) => {
  const {data,error} = await supabase.from('portal_roles').select('role').eq('auth_user_id',req.user.id).maybeSingle();
  if (error) return res.status(500).json({error:'Authorization lookup failed'});
  if (data?.role !== 'hr_admin') return res.status(403).json({error:'Forbidden'});
  res.set('Cache-Control','no-store');
  res.json({ admin: true });
});

// Profile fields are explicitly allowlisted. Never accept auth_user_id or role from clients.
const profileFields=['surname','given_name','employee_code','job_title','branch_code','start_date','status','employment_type','phone','contact_email','emergency_contact','emergency_phone','address','education','training_status','notes'];
const profileSelect=profileFields.join(',');
async function isHrAdmin(userId) {
  const {data,error}=await supabase.from('portal_roles').select('role').eq('auth_user_id',userId).maybeSingle();
  if(error) throw error;
  return data?.role==='hr_admin';
}
function validateProfile(body) {
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!profileFields.includes(k))) return null;
  const clean={};
  for(const key of profileFields) {
    const value=body[key];
    if(value===undefined) continue;
    if(value!==null && typeof value!=='string') return null;
    const v=typeof value==='string'?value.trim():'';
    if(v.length>300 || (key==='start_date' && v && !/^\\d{4}-\\d{2}-\\d{2}$/.test(v))) return null;
    clean[key]=v||null;
  }
  return clean;
}
app.get('/api/profile',authenticate,async(req,res)=>{
  const {data,error}=await supabase.from('employee_profiles').select(profileSelect).eq('auth_user_id',req.user.id).maybeSingle();
  res.set('Cache-Control','no-store');
  if(error)return res.status(500).json({error:'Анкет уншиж чадсангүй'});
  res.json({profile:data||null});
});
app.put('/api/profile',authenticate,async(req,res)=>{
  const clean=validateProfile(req.body);
  if(!clean || Object.keys(clean).length===0)return res.status(400).json({error:'Анкетын талбаруудыг шалгана уу'});
  let admin;
  try{admin=await isHrAdmin(req.user.id);}catch{return res.status(500).json({error:'Эрх шалгаж чадсангүй'});}
  const {data:existing,error:readError}=await supabase.from('employee_profiles').select('auth_user_id').eq('auth_user_id',req.user.id).maybeSingle();
  if(readError)return res.status(500).json({error:'Анкет шалгаж чадсангүй'});
  // Employment identity and assignments are controlled by HR only.
  const hrFields=['employee_code','job_title','branch_code','start_date','status','employment_type','training_status'];
  if(!admin && Object.keys(clean).some(k=>hrFields.includes(k)))return res.status(403).json({error:'Эдгээр ажлын талбарыг зөвхөн HR админ засна'});
  if(!existing && !admin)return res.status(403).json({error:'Анхны анкетыг HR админ баталгаажуулах шаардлагатай'});
  if(!existing && (!clean.employee_code || !clean.given_name || !clean.surname))return res.status(400).json({error:'Шинэ анкетад код, овог, нэр шаардлагатай'});
  const query=existing
    ? supabase.from('employee_profiles').update(clean).eq('auth_user_id',req.user.id)
    : supabase.from('employee_profiles').insert({...clean,auth_user_id:req.user.id});
  const {data,error}=await query.select(profileSelect).single();
  res.set('Cache-Control','no-store');
  if(error){console.error('Profile save failed:',error.code||'unknown');return res.status(400).json({error:'Анкет хадгалж чадсангүй. Хүснэгтийн бүтэц болон давхардсан кодыг шалгана уу'});}
  res.json({profile:data});
});
app.get('/api/admin/employees',authenticate,async(req,res)=>{
  try{if(!await isHrAdmin(req.user.id))return res.status(403).json({error:'Зөвшөөрөлгүй'});}catch{return res.status(500).json({error:'Эрх шалгаж чадсангүй'});}
  const {data,error}=await supabase.from('employee_profiles').select('employee_code,given_name,surname,job_title,branch_id').order('employee_code',{ascending:true}).limit(100);
  res.set('Cache-Control','no-store');
  if(error)return res.status(500).json({error:'Ажилтны жагсаалт уншиж чадсангүй'});
  res.json({employees:data||[],limitedTo:100});
});


const inviteHash=token=>createHash('sha256').update(token).digest('hex');
const inviteTokenValid=token=>typeof token==='string'&&/^[a-f0-9]{64}$/.test(token);
const inviteAdminLimit=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-7',legacyHeaders:false});
const invitePublicLimit=rateLimit({windowMs:15*60*1000,limit:15,standardHeaders:'draft-7',legacyHeaders:false});
async function reviewScope(req,res,next){
 try{const scope=await staffScope(req.user.id);if(!scope)return res.status(403).json({error:'Эрхгүй'});req.staffScope=scope;next();}
 catch{return res.status(500).json({error:'Эрх шалгах үед алдаа гарлаа'});}
}
app.post('/api/invites',authenticate,reviewScope,inviteAdminLimit,async(req,res)=>{
 const branchId=req.staffScope.branchId;
 if(!branchId)return res.status(403).json({error:'Урилга үүсгэх салбар сонгогдоогүй'});
 const token=randomBytes(32).toString('hex');
 const expiresAt=new Date(Date.now()+24*60*60*1000).toISOString();
 const {error}=await supabase.from('employee_invites').insert({token_hash:inviteHash(token),branch_id:branchId,created_by:req.user.id,expires_at:expiresAt});
 res.set('Cache-Control','no-store');
 if(error)return res.status(500).json({error:'Холбоос үүсгэж чадсангүй'});
 // Build from the request host; only same-origin deployment URLs are accepted by this server.
 const link=new URL('/employee-form?token='+token,req.protocol+'://'+req.get('host')).toString();
 res.status(201).json({link,expires_at:expiresAt});
});
app.get('/employee-form',(_req,res)=>{res.set('Cache-Control','no-store');res.sendFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public/employee-form.html'));});
app.get('/employee-form.js',(_req,res)=>{res.set('Cache-Control','no-store');res.sendFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public/employee-form.js'));});
app.get('/api/invites/:token',invitePublicLimit,async(req,res)=>{
 if(!inviteTokenValid(req.params.token))return res.status(404).json({error:'Холбоос хүчингүй'});
 const {data,error}=await supabase.from('employee_invites').select('id,branch_id,expires_at,used_at,revoked_at').eq('token_hash',inviteHash(req.params.token)).maybeSingle();
 res.set('Cache-Control','no-store');
 if(error||!data||data.used_at||data.revoked_at||new Date(data.expires_at).getTime()<=Date.now())return res.status(410).json({error:'Холбоос хүчингүй эсвэл хугацаа дууссан'});
 const {data:branch}=await supabase.from('branches').select('branch_code,branch_name').eq('id',data.branch_id).maybeSingle();
 res.json({branch:branch?{code:branch.branch_code,name:branch.branch_name}:null,expires_at:data.expires_at});
});
app.post('/api/invites/:token/submit',invitePublicLimit,async(req,res)=>{
 if(!inviteTokenValid(req.params.token))return res.status(404).json({error:'Холбоос хүчингүй'});
 const values=normalizeStaffInput(req.body);
 if(!values||!/^\d{6}$/.test(values.employee_code||'')||!values.surname||!values.given_name)return res.status(400).json({error:'6 оронтой код, овог, нэр заавал шаардлагатай'});
 const {data:invite,error:lookupError}=await supabase.from('employee_invites').select('id,branch_id,expires_at,used_at,revoked_at').eq('token_hash',inviteHash(req.params.token)).maybeSingle();
 if(lookupError||!invite||invite.used_at||invite.revoked_at||new Date(invite.expires_at).getTime()<=Date.now())return res.status(410).json({error:'Холбоос хүчингүй эсвэл хугацаа дууссан'});
 // Claim once atomically before accepting a submission.
 const {data:claimed,error:claimError}=await supabase.from('employee_invites').update({used_at:new Date().toISOString()}).eq('id',invite.id).is('used_at',null).is('revoked_at',null).gt('expires_at',new Date().toISOString()).select('id').maybeSingle();
 if(claimError||!claimed)return res.status(409).json({error:'Холбоос аль хэдийн ашиглагдсан'});
 const {error}=await supabase.from('employee_submissions').insert({invite_id:invite.id,branch_id:invite.branch_id,payload:values});
 res.set('Cache-Control','no-store');
 if(error){console.error('Submission save error',error.code);return res.status(500).json({error:'Анкет хүлээн авахад алдаа гарлаа. HR-д мэдэгдэнэ үү'});}
 res.status(201).json({message:'Анкет HR админы шалгалтад очлоо'});
});
app.get('/api/submissions',authenticate,reviewScope,async(req,res)=>{
 let q=supabase.from('employee_submissions').select('id,branch_id,payload,status,created_at').eq('status','pending').order('created_at',{ascending:false}).limit(100);
 if(!req.staffScope.admin)q=q.eq('branch_id',req.staffScope.branchId);
 const {data,error}=await q;
 res.set('Cache-Control','no-store');
 if(error)return res.status(500).json({error:'Ирсэн анкетуудыг уншиж чадсангүй'});
 res.json({submissions:(data||[]).map(x=>({...x,payload:publicStaff(x.payload)}))});
});
app.post('/api/submissions/:id/review',authenticate,reviewScope,async(req,res)=>{
 if(!/^[0-9a-f-]{36}$/i.test(req.params.id)||!['approved','rejected'].includes(req.body?.decision))return res.status(400).json({error:'Хүсэлт буруу'});
 let q=supabase.from('employee_submissions').select('id,branch_id,payload,status').eq('id',req.params.id);
 if(!req.staffScope.admin)q=q.eq('branch_id',req.staffScope.branchId);
 const {data:submission,error}=await q.maybeSingle();
 if(error||!submission)return res.status(404).json({error:'Анкет олдсонгүй'});
 if(submission.status!=='pending')return res.status(409).json({error:'Анкет өмнө нь шийдвэрлэгдсэн'});
 if(req.body.decision==='approved'){
  const {error:saveError}=await supabase.from('employee_profiles').insert({...submission.payload,branch_id:submission.branch_id});
  if(saveError)return res.status(409).json({error:saveError.code==='23505'?'Ажилтны код аль хэдийн бүртгэлтэй':'Анкет баталгаажуулж чадсангүй'});
 }
 const {error:updateError}=await supabase.from('employee_submissions').update({status:req.body.decision,reviewed_by:req.user.id,reviewed_at:new Date().toISOString()}).eq('id',submission.id).eq('status','pending');
 if(updateError)return res.status(500).json({error:'Шийдвэрийг хадгалж чадсангүй'});
 res.set('Cache-Control','no-store');res.json({status:req.body.decision});
});

const employeeFormFields=['surname','given_name','employee_code','job_title','start_date','status','employment_type','phone','contact_email','emergency_contact','emergency_phone','address','education','training_status','notes'];
const dbFieldMap={contact_email:'email',emergency_contact:'emergency_contact_name',emergency_phone:'emergency_contact_phone',address:'address_text'};
const employeeColumns=['employee_code','surname','given_name','job_title','branch_id','start_date','status','employment_type','phone','email','emergency_contact_name','emergency_contact_phone','address_text','education','training_status','notes'];
const employeeSelect=employeeColumns.join(',');
async function staffScope(userId){
 const {data:role,error:roleError}=await supabase.from('portal_roles').select('role').eq('auth_user_id',userId).maybeSingle();
 if(roleError)throw roleError;
 if(role?.role==='hr_admin'){
  const {data:assignment,error}=await supabase.from('manager_branches').select('branch_id').eq('auth_user_id',userId).maybeSingle();
  if(error)throw error;
  return {admin:true,branchId:assignment?.branch_id||null};
 }
 if(role?.role!=='manager')return null;
 const {data:assignment,error}=await supabase.from('manager_branches').select('branch_id').eq('auth_user_id',userId).maybeSingle();
 if(error)throw error;
 return assignment?.branch_id?{admin:false,branchId:assignment.branch_id}:null;
}
async function staffGuard(req,res,next){
 try{const scope=await staffScope(req.user.id);if(!scope)return res.status(403).json({error:'Менежерийн салбарын эрх тохируулагдаагүй'});req.staffScope=scope;next();}
 catch{return res.status(500).json({error:'Эрх шалгах үед алдаа гарлаа'});}
}
function normalizeStaffInput(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!employeeFormFields.includes(k)))return null;
 const values={};
 for(const [key,val] of Object.entries(body)){
  if(val!==null&&typeof val!=='string')return null;
  const value=typeof val==='string'?val.trim():'';
  if(value.length>300)return null;
  if(key==='start_date'&&value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  values[dbFieldMap[key]||key]=value||null;
 }
 return values;
}
function publicStaff(row){
 if(!row)return null;
 const result={...row};
 for(const [ui,db] of Object.entries(dbFieldMap)){result[ui]=result[db];delete result[db];}
 return result;
}
app.get('/api/staff',authenticate,staffGuard,async(req,res)=>{
 let query=supabase.from('employee_profiles').select('employee_code,surname,given_name,job_title,branch_id,status').order('employee_code').limit(200);
 if(!req.staffScope.admin)query=query.eq('branch_id',req.staffScope.branchId);
 const {data,error}=await query;
 res.set('Cache-Control','no-store');
 if(error)return res.status(500).json({error:'Ажилтны жагсаалт уншиж чадсангүй'});
 res.json({employees:data||[]});
});
app.get('/api/staff/:code',authenticate,staffGuard,async(req,res)=>{
 if(!/^\d{6}$/.test(req.params.code))return res.status(400).json({error:'6 оронтой код оруулна уу'});
 let query=supabase.from('employee_profiles').select(employeeSelect).eq('employee_code',req.params.code);
 if(!req.staffScope.admin)query=query.eq('branch_id',req.staffScope.branchId);
 const {data,error}=await query.maybeSingle();
 res.set('Cache-Control','no-store');
 if(error)return res.status(500).json({error:'Анкет уншиж чадсангүй'});
 if(!data)return res.status(404).json({error:'Ажилтан олдсонгүй'});
 res.json({employee:publicStaff(data)});
});
app.post('/api/staff',authenticate,staffGuard,async(req,res)=>{
 const values=normalizeStaffInput(req.body);
 if(!values||!/^\d{6}$/.test(values.employee_code||'')||!values.surname||!values.given_name)return res.status(400).json({error:'6 оронтой код, овог, нэр заавал шаардлагатай'});
 // Managers may only create records assigned to their verified branch.
 // HR must select a branch separately before using this endpoint.
 if(!req.staffScope.branchId)return res.status(403).json({error:'Анкет үүсгэх салбар холбогдоогүй'});
 const {data,error}=await supabase.from('employee_profiles').insert({...values,branch_id:req.staffScope.branchId}).select(employeeSelect).single();
 res.set('Cache-Control','no-store');
 if(error){if(error.code==='23505')return res.status(409).json({error:'Энэ ажилтны код аль хэдийн бүртгэлтэй'});return res.status(400).json({error:'Анкет хадгалж чадсангүй. Бүртгэлийн шаардлагыг шалгана уу'});}
 res.status(201).json({employee:publicStaff(data)});
});
app.patch('/api/staff/:code',authenticate,staffGuard,async(req,res)=>{
 if(!/^\d{6}$/.test(req.params.code))return res.status(400).json({error:'Ажилтны код буруу'});
 const values=normalizeStaffInput(req.body);
 if(!values||!Object.keys(values).length||'employee_code' in values)return res.status(400).json({error:'Засах талбаруудыг шалгана уу'});
 let query=supabase.from('employee_profiles').update(values).eq('employee_code',req.params.code);
 if(!req.staffScope.admin)query=query.eq('branch_id',req.staffScope.branchId);
 const {data,error}=await query.select(employeeSelect).maybeSingle();
 res.set('Cache-Control','no-store');
 if(error)return res.status(400).json({error:'Анкет шинэчилж чадсангүй'});
 if(!data)return res.status(404).json({error:'Ажилтан олдсонгүй эсвэл эрх хүрэхгүй байна'});
 res.json({employee:publicStaff(data)});
});

// Payroll and cash routes intentionally NOT exposed until private Sheets access,
// verified employee-code mapping, auditing, and source endpoint lockdown are complete.
app.use((err,_req,res,_next) => { console.error(err.message); res.status(500).json({error:'Server error'}); });
export default app;
