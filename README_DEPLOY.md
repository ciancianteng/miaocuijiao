# MEOW CUI JIAO Phase 1 Deploy

> **上线流程（Staging / Production）**  
> - 公开预览 = Staging = Vercel Preview → [`STAGING_SETUP.md`](./STAGING_SETUP.md)  
> - 正式环境 → [`PRODUCTION_SETUP.md`](./PRODUCTION_SETUP.md)  
> - 发版打勾 → [`DEPLOY_CHECKLIST.md`](./DEPLOY_CHECKLIST.md)  
> - 环境变量模板：`.env.preview.example`（测库 + HitPay Sandbox）、`.env.production.example`（正式库 + HitPay Live）

## 1. Environment

Copy `.env.example` to `.env.local` and fill (prefer **Staging / Sandbox** values locally):

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SERVICE_SESSION_SECRET=
COMPANION_SESSION_SECRET=
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Do not put it in browser code.

## 2. Database

Run `docs/phase1-supabase-schema.sql` in the Supabase SQL editor.

Phase 1 tables:

- `profiles`
- `companion_profiles`
- `orders`
- `conversations`
- `messages`
- `transactions`
- `banners`
- `announcements`
- `customer_service_reports`

## 3. Auth Roles

Create Supabase Auth users, then add one row in `profiles` for each user:

- `boss`
- `companion`
- `customer_service`
- `admin`

Only `status = active` accounts can log in.

## 4. Local Run

```bash
npm run dev
```

Open:

- Boss: `http://localhost:5190/`
- Companion: `http://localhost:5190/companion/`
- Customer service: `http://localhost:5190/customer-service/`
- Admin: `http://localhost:5190/admin/`
- Salary report review: `http://localhost:5190/report/`

## 5. Verification

Check database/auth health:

```bash
curl http://localhost:5190/api/auth?action=health
```

Expected:

- `configured: true`
- `missing: []`

If `configured` is false, login is intentionally disabled instead of creating fake users.

## 6. V1 Test Accounts

Create these four Supabase Auth users before acceptance testing. Use the same email in `auth.users` and `profiles.email`.

> Initial password for all test accounts: `McjTest@12345678`
> Change all passwords before production launch.

| Role | Email | profiles.role | profiles.status |
| --- | --- | --- | --- |
| Admin | admin@meow.test | admin | active |
| Customer service | service@meow.test | customer_service | active |
| Companion | companion@meow.test | companion | active |
| Boss | boss@meow.test | boss | active |

For the companion test account, also create one `companion_profiles` row:

```sql
insert into public.companion_profiles (
  user_id, nickname, game, level_name, price, commission_rate,
  deposit_status, verification_status, online_status, description
)
select id, '测试陪玩', 'VALORANT', 'Lv.1 萌喵', 30, 80,
  'paid', 'approved', 'online', 'V1 验收测试陪玩'
from public.profiles
where email = 'companion@meow.test'
on conflict do nothing;
```

## 7. Production Routes

`vercel.json` keeps these routes refresh-safe:

- `/`
- `/login`
- `/orders`
- `/support`
- `/companion`
- `/customer-service`
- `/admin`
- `/report`

## 8. V1 Acceptance Checklist

Run after Supabase environment variables are configured locally and on Vercel:

1. Boss logs in with `boss@meow.test`.
2. Boss creates an order.
3. Boss opens online service and sends a message.
4. Customer service logs in with `service@meow.test`.
5. Customer service takes the conversation, replies, creates or confirms the order payment.
6. Order enters `pending` and appears in the companion order hall.
7. Companion logs in with `companion@meow.test`.
8. Companion switches online, claims the order, starts it, and completes it.
9. Boss confirms companion when the order is `waiting_boss_confirm`.
10. Customer service submits a salary report.
11. Admin logs in with `admin@meow.test`.
12. Admin reviews salary report, edits Banner, edits announcement, and checks order list.

If `/api/auth?action=health` returns `configured: false`, do not run acceptance testing because the app will intentionally reject real writes instead of creating fake data.

## 9. Deferred For Phase 2

Hidden or deferred for V1:

- VIP
- Coupons
- Invite rebate
- Automatic payment
- Automatic salary calculation
- Complex finance reports
- Marketing campaigns
- Rankings
- Gift system
- Multi-club management
