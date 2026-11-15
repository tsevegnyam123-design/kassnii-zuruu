# GS25 Portal — GitHub Pages + Supabase (Vercel шаардахгүй)

## Архитектур

- **GitHub Pages**: `index.html` статик веб.
- **Supabase Edge Function**: `supabase/functions/portal/index.ts`, public endpoint `https://zxhbufwncnijmpwzokvt.supabase.co/functions/v1/portal`.
- **Supabase PostgreSQL**: `portal_v2_accounts`, `portal_v2_sessions`, `portal_v2_shifts`, `portal_v2_cash`.
- **Google Sheets, opensheet, Vercel**: Шинэ GitHub Pages хувилбар огт ашиглахгүй.

Энд нэмэлт OTP баталгаажуулалт байхгүй. Нэвтрэхдээ ажилтны код + **4 оронтой PIN** оруулна. PIN нь мэдээллийн санд зөвхөн bcrypt hash-аар хадгалагдана. 5 удаа дараалан алдаа гаргавал 15 минут түгжинэ. Сешн token-ийг браузерийн *санах ойд* л хадгална (refresh хийхэд дахин нэвтэрнэ).

## Нийтлэх

1. `main` branch-д өөрчлөлт орсны дараа GitHub repository → **Settings → Pages → Build and deployment** рүү орно.
2. **Source = GitHub Actions** сонгоно.
3. **Actions** хэсэгт `Deploy GS25 portal to GitHub Pages` workflow автоматаар ажиллах эсвэл `Run workflow` дарна.
4. Сайт: `https://tsevegnyam123-design.github.io/kassnii-zuruu/`.

**Чухал:** GitHub API холбогч Pages-ийн Settings тохиргоог өөрчлөх эрхгүй тул GitHub Pages эхний удаа идэвхжүүлэхдээ owner нь 2-р алхмыг хийнэ. Хэрэв 404 бол Pages тохиргоо болон Actions log-ийг шалгана.

## Supabase

**Project:** `gs25-employee-portal` (`zxhbufwncnijmpwzokvt`).

- `database/portal_v2.sql` migration-г Supabase project-д 2026-11-16-д ажиллуулсан.
- `portal` Edge Function `verify_jwt=false` горимоор нийтлэгдсэн, учир нь PIN сешнийг функц өөрөө сервер талд шалгадаг.
- Browser CORS allowlist: `https://tsevegnyam123-design.github.io`.
- `SUPABASE_SERVICE_ROLE_KEY`-ийг **зөвхөн Edge Function** уншина. GitHub-д, `index.html`-д, браузерт **хэзээ ч** байршуулахгүй.

## Менежер 115091-д нэвтрэх эрх үүсгэх

Менежерийн ID-ийг мэдэх нь хангалтгүй: мэдээллийн санд `access_role='manager'` байх ёстой. Одоогоор анхны менежерийн PIN заагаагүй бол нэвтрэхгүй.

Зөвхөн Supabase **SQL Editor** нууц орчинд админ өөрийн сонгосон 4 цифр PIN-ээ оруулж, өөрийн салбарын кодыг сонгоод энэ SQL-ийг ажиллуулна:

```sql
insert into public.portal_v2_accounts
(employee_code,pin_hash,display_name,branch_code,access_role,salary_role,level)
values (
  '115091', extensions.crypt('<4 ОРОНТОЙ PIN>', extensions.gen_salt('bf',12)),
  'Салбарын менежер', '<САЛБАРЫН КОД>', 'manager', 'BM', 1
);
```

PIN-ээ чат, GitHub, файл, зураг, screenshot-д **бүү явуул**. Зөвхөн Supabase SQL Editor дээр оруул. Салбарын код одоогийн ажилтнуудын кодтой тохирох ёстой. Хэрэв `115091` бүртгэл өмнө нь үүссэн бол `insert`-ийн оронд админаар хянуулж `update` ашиглана.

## Туршилтын шалгах жагсаалт

- Нэвтрээгүй үед ажилтны ээлж/цалин/кассын зөрүү API-аас буцаагдахгүй.
- 115091 менежерээр нэвтэрч нэг **туршилтын** ажилтан үүсгэнэ.
- Менежер өдөр бүрийн ээлж сонгоход батлагдсан байдлаар хадгалагдана.
- Тухайн ажилтнаар нэвтэрч зөвхөн **өөрийн** ээлж, урьдчилсан цалин, кассын зөрүүг харна.
- Өөр салбарын болон бусад ажилтны мэдээллийг ажилтны эрхээр авах боломжгүй.
- Кассын зөрүү орсон үед цалингаас автоматаар суутгахгүй, тусдаа харагдана.
- Нэгэнт нэвтэрсэн сешнийг logout хийхэд хүчингүй болгоно.
- Шөнийн ээлжийн шөнийн цагийг өмнөх GitHub цалин тооцоолуурын **6.25** цагийн дүрмээр бодно.
- Цалингийн тооцоо бол **урьдчилсан**; SOP, KPI, баяр, илүү цаг, бодит бүх суутгал ороогүй.

Ажилтны хувийн мэдээллийн анкет, гэрийн хаяг, Google Maps, утас/email асуух хэсэг байхгүй. Ажилтан бүртгэх талбарт зөвхөн ID, нэр, албан тушаал, level, 4 цифр PIN болон менежерийн салбар байна.

## Аюулгүй ажиллагаа

4 цифр PIN нь сул тул HTTPS, 5 удаагийн login lockout, session TTL, мэдээллийг зөвхөн backend-аас салбар/ажилтны кодоор шүүх хамгаалалтыг хадгална. Жинхэнэ ажилтны цалингийн мэдээллийг оруулахаас өмнө хөндлөнгийн тест, менежерийн эрхийн шалгалт, SQL policies, logs хянана.

GitHub Pages-ийн UI нэг URL дээр, backend Supabase-ийн тусдаа домэйн дээр байна. Cross-origin cookie хэрэглэхгүй, token-ийг зөвхөн ажиллаж буй хуудасны RAM-д хадгална. Reload хийхэд нэвтрэх хуудас дахин гарна.
