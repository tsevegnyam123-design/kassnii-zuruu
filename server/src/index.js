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
// Payroll and cash routes intentionally NOT exposed until private Sheets access,
// verified employee-code mapping, auditing, and source endpoint lockdown are complete.
app.use((err,_req,res,_next) => { console.error(err.message); res.status(500).json({error:'Server error'}); });
export default app;
