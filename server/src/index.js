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
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin(origin, cb) { if (!origin || allowedOrigins.includes(origin)) return cb(null, true); cb(null, false); }, credentials: false }));
// Same-origin browser requests do not require CORS. Only explicitly allowed cross-origin sites receive CORS headers.
app.use((req,res,next) => { const origin=req.get('origin'); if (origin && origin !== `${req.protocol}://${req.get('host')}` && !allowedOrigins.includes(origin)) return res.status(403).json({error:'Origin not allowed'}); next(); });
app.use(express.json({ limit: '16kb' }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false }));
const publicIndex = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/index.html');
app.get('/', (_req,res) => res.sendFile(publicIndex));
app.get('/login.js', (_req,res) => res.sendFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/login.js')));
app.get('/api/health', (_req,res) => res.json({ status: 'ok' }));
// Initial login uses the Supabase Auth email/password configured for the admin.
// Employee-code login is not enabled until a verified code-to-auth mapping exists.
app.post('/api/login', rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-7',legacyHeaders:false}), async (req,res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 1024 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return res.status(400).json({error:'Valid email and password required'});
  const client = createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
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
// Payroll and cash routes intentionally NOT exposed until private Sheets access,
// verified employee-code mapping, auditing, and source endpoint lockdown are complete.
app.use((err,_req,res,_next) => { console.error(err.message); res.status(500).json({error:'Server error'}); });
export default app;
