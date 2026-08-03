# TPKELE CRM 可信设备登录实施设计

## 1. 当前项目现状

当前 CRM 是静态页面 + Express API：

- 前端登录页：`login.html`
- 后端入口：`api/index.js`
- 登录接口：`POST /api/login`
- 登录态：后端签发 JWT，前端保存到 `localStorage.crm_token`
- 数据库：Supabase REST，Postgres UUID 表结构
- 用户表：已有 `users.phone` 字段，可用于绑定手机号
- 管理员账号：来自环境变量 `CRM_USERNAME` / `CRM_PASSWORD`

本次设计先不重做整套认证系统，保持现有 JWT 和页面访问方式不变，只在登录流程中新增：

- 可信设备 Cookie
- 陌生设备短信验证码
- 已信任设备管理
- 登录安全审计

这样改动范围小，`dashboard.html`、`documents.html`、`email.html` 等现有页面基本不用改。

## 2. 目标效果

- 你的常用电脑、你的手机：账号密码正确后直接进入 CRM。
- 新电脑、新浏览器、清除 Cookie 后：账号密码正确后还需要手机验证码。
- 验证通过后可以勾选“信任此设备 90 天”。
- 在账号安全页面可以撤销单个设备或撤销全部设备。
- 修改密码、更换手机号、导出敏感数据等操作可以后续加二次验证。

## 3. 不做的方案

不要用 IP 地址判断是不是常用电脑。宽带、手机网络都会变化，而且同一个网络下可能有别人。

不要用 MAC 地址。浏览器拿不到真实 MAC，页面底部现在显示的 MAC 也不应作为安全依据。

不要只用浏览器指纹。指纹容易误判，也可能被伪造，只能作为辅助风险信号。

不要把“可信设备=true”放到 localStorage。前端存储可以被用户自己改，不能作为安全凭证。

## 4. 总体登录流程

### 4.1 常用设备登录

1. 用户打开 `login.html`。
2. 输入账号密码。
3. 前端请求 `POST /api/login`。
4. 后端验证账号密码。
5. 后端读取 Cookie `crm_trusted_device`。
6. 如果可信设备 token 有效，直接签发 JWT。
7. 前端保存 `crm_token`，跳转 `dashboard.html`。

### 4.2 陌生设备登录

1. 用户输入账号密码。
2. 后端验证账号密码正确。
3. 后端发现没有有效可信设备 token。
4. 后端创建验证码挑战，发送短信到用户绑定手机号。
5. `/api/login` 返回 `otp_required`。
6. 前端切换到验证码输入界面。
7. 用户输入短信验证码。
8. 前端请求 `POST /api/login/verify-otp`。
9. 后端验证验证码。
10. 如果勾选了“信任此设备”，后端写入可信设备 Cookie。
11. 后端签发 JWT，前端进入 CRM。

## 5. API 设计

### 5.1 POST /api/login

保持原接口地址不变，但响应增加一种状态。

请求：

```json
{
  "username": "TPKELE",
  "password": "your-password"
}
```

可信设备有效时，保持兼容现有前端：

```json
{
  "status": "logged_in",
  "token": "jwt-token",
  "username": "TPKELE",
  "user": {
    "id": "uuid",
    "username": "TPKELE",
    "role": "admin",
    "display_name": "Administrator"
  }
}
```

陌生设备时：

```json
{
  "status": "otp_required",
  "challengeToken": "temporary-random-token",
  "maskedPhone": "138****5678",
  "expiresIn": 300
}
```

账号密码错误时：

```json
{
  "message": "Invalid credentials"
}
```

### 5.2 POST /api/login/verify-otp

新接口，用于校验短信验证码。

请求：

```json
{
  "challengeToken": "temporary-random-token",
  "otp": "123456",
  "trustDevice": true,
  "deviceName": "我的办公电脑"
}
```

响应：

```json
{
  "status": "logged_in",
  "token": "jwt-token",
  "username": "TPKELE",
  "trustedDeviceCreated": true,
  "user": {
    "id": "uuid",
    "username": "TPKELE",
    "role": "admin",
    "display_name": "Administrator"
  }
}
```

### 5.3 GET /api/account/security/trusted-devices

需要 JWT。

返回当前用户已信任设备：

```json
{
  "devices": [
    {
      "id": "uuid",
      "deviceName": "Windows Chrome",
      "lastIp": "1.2.3.4",
      "createdAt": "2026-07-19T10:00:00Z",
      "lastUsedAt": "2026-07-19T11:30:00Z",
      "expiresAt": "2026-10-17T10:00:00Z",
      "isCurrentDevice": true
    }
  ]
}
```

### 5.4 DELETE /api/account/security/trusted-devices/:id

撤销单个可信设备。

### 5.5 POST /api/account/security/trusted-devices/revoke-all

撤销当前用户全部可信设备。

### 5.6 GET /api/account/security/login-logs

查看最近登录和验证记录。

## 6. Cookie 设计

新增可信设备 Cookie：

```text
Name: crm_trusted_device
HttpOnly: true
Secure: true
SameSite: Lax
Path: /
Max-Age: 90 days
```

Cookie 值是 32 字节以上随机 token，例如：

```js
crypto.randomBytes(32).toString('base64url')
```

数据库只保存 token 哈希：

```js
HMAC-SHA-256(token, TRUSTED_DEVICE_SECRET)
```

推荐新增环境变量：

```text
TRUSTED_DEVICE_SECRET=至少32位随机字符串
CRM_ADMIN_PHONE=你的手机号
SMS_PROVIDER=aliyun 或 twilio 或 mock
SMS_ACCESS_KEY_ID=短信服务配置
SMS_ACCESS_KEY_SECRET=短信服务配置
SMS_SIGN_NAME=短信签名
SMS_TEMPLATE_CODE=短信模板
```

如果第一版还没接短信服务，可以先用 `SMS_PROVIDER=mock` 在服务端日志里打印验证码，但上线前必须换成真实短信。

## 7. Supabase 表结构

新建迁移文件建议命名：

```text
schema_v2_15_trusted_device_login.sql
```

SQL：

```sql
CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  device_name TEXT,
  user_agent_hash TEXT,
  last_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_id
  ON trusted_devices(user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trusted_devices_expires_at
  ON trusted_devices(expires_at);

CREATE TABLE IF NOT EXISTS login_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  challenge_token_hash TEXT NOT NULL UNIQUE,
  otp_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login_new_device',
  sent_to_phone_masked TEXT,
  ip TEXT,
  user_agent_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_challenges_user_id
  ON login_challenges(user_id);

CREATE INDEX IF NOT EXISTS idx_login_challenges_expires_at
  ON login_challenges(expires_at);

CREATE TABLE IF NOT EXISTS login_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  account_identifier TEXT,
  event_type TEXT NOT NULL,
  result TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  device_id UUID,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_audit_logs_user_id
  ON login_audit_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_login_audit_logs_created_at
  ON login_audit_logs(created_at DESC);
```

## 8. 后端改造点

主要集中在 `api/index.js` 的 AUTH 区域。

### 8.1 新增工具函数

建议增加：

- `parseCookies(req)`
- `setCookie(res, name, value, options)`
- `clearCookie(res, name)`
- `hmacToken(value)`
- `sha256(value)`
- `getClientIp(req)`
- `maskPhone(phone)`
- `generateOtp()`
- `hashOtp(otp, challengeToken)`
- `verifyOtp(otp, storedHash, challengeToken)`
- `createJwtForUser(user)`
- `auditLogin(event)`

### 8.2 改造 ensureAdminUser

当前 `ensureAdminUser()` 会自动创建管理员用户，但没有手机号。

建议：

- 如果环境变量 `CRM_ADMIN_PHONE` 存在，自动写入 `users.phone`。
- 如果 `users.phone` 和 `CRM_ADMIN_PHONE` 都没有，则陌生设备登录时返回配置错误：`Admin phone not configured`。

### 8.3 改造 /api/login

现在逻辑是账号密码正确后直接签发 JWT。

新逻辑：

1. 校验 username/password。
2. `ensureAdminUser()`。
3. 检查可信设备 Cookie。
4. 如果可信，签发 JWT。
5. 如果不可信，发送 OTP，返回 `otp_required`。

### 8.4 新增 /api/login/verify-otp

新逻辑：

1. 校验 challengeToken。
2. 查询 `login_challenges`。
3. 检查是否过期、是否已使用、是否超过尝试次数。
4. 校验验证码。
5. 标记 challenge consumed。
6. 如果 `trustDevice=true`，生成可信设备 token，写入数据库和 Cookie。
7. 签发 JWT。

### 8.5 新增设备管理接口

新增：

- `GET /api/account/security/trusted-devices`
- `DELETE /api/account/security/trusted-devices/:id`
- `POST /api/account/security/trusted-devices/revoke-all`
- `GET /api/account/security/login-logs`

可以先不做独立页面，先在后端接口完成；第二步再加 UI。

## 9. 前端改造点

主要改 `login.html`。

当前登录成功判断：

```js
if (!res.ok || !data.token) throw new Error(data.message || T[cl].er);
```

需要改为：

```js
if (data.status === 'otp_required') {
  showOtpStep(data.challengeToken, data.maskedPhone, data.expiresIn);
  return;
}

if (!res.ok || !data.token) throw new Error(data.message || T[cl].er);
```

验证码界面需要新增：

- 验证码输入框
- 手机号掩码提示
- 信任此设备复选框，默认勾选
- 验证按钮
- 返回账号密码登录按钮

建议 UI 文案：

```text
安全验证
验证码已发送至 138****5678
信任此设备 90 天
验证并登录
```

## 10. 短信服务方案

第一版可以抽象一个 `sendOtpSms(phone, otp)` 函数。

推荐优先级：

1. 如果你主要用中国大陆手机号：阿里云短信。
2. 如果海外手机号更多：Twilio。
3. 本地开发：mock，只在服务端日志输出验证码。

上线前要求：

- 不能把验证码返回给前端。
- 不能在生产日志长期保留验证码。
- 短信发送必须有限流。

## 11. 限流策略

当前项目部署在 Vercel serverless 上，纯内存限流不稳定，因为实例会重启或横向扩容。

第一版可以用数据库计数方式：

- 查询最近 10 分钟 `login_audit_logs` 中同一账号失败次数。
- 查询最近 10 分钟同一 IP 触发 OTP 次数。
- 查询最近 1 小时同一手机号 OTP 次数。

建议限制：

```text
账号密码失败：同一账号 10 分钟 5 次
OTP 发送：同一账号 10 分钟 3 次
OTP 发送：同一手机号 1 小时 5 次
OTP 尝试：单个 challenge 最多 5 次
```

## 12. 敏感操作二次验证

第一版先保护登录。后续建议对这些操作加 step-up 验证：

- 修改密码保险柜二级密码
- 查看密码保险柜明文密码
- 导出客户资料
- 彻底删除回收站数据
- 新增/修改管理员
- 更换绑定手机号

当前项目里优先关注：

- `POST /api/password-vault/items/:id/reveal`
- `DELETE /api/recycle-bin/purge`
- 文档导出相关接口

## 13. 实施顺序

推荐分 4 步做，风险最低：

### 第一步：数据库与后端基础

- 新增 `schema_v2_15_trusted_device_login.sql`
- 增加环境变量 `TRUSTED_DEVICE_SECRET`、`CRM_ADMIN_PHONE`
- 在 `api/index.js` 增加 token、OTP、Cookie 工具函数
- 增加登录审计日志

### 第二步：登录流程改造

- 改造 `POST /api/login`
- 新增 `POST /api/login/verify-otp`
- 接入 mock 短信，先本地验证流程

### 第三步：接真实短信

- 接入阿里云或 Twilio
- 加发送频率限制
- 在 Vercel 配置短信环境变量

### 第四步：账号安全页面

- 新增 `security.html` 或放到 `dashboard.html` 的设置区域
- 展示可信设备
- 支持撤销单个设备
- 支持撤销全部设备
- 展示最近登录记录

## 14. 测试清单

- 第一次登录会要求验证码。
- 验证码错误不能登录。
- 验证码 5 分钟后失效。
- 验证码输错 5 次后 challenge 失效。
- 勾选信任设备后，再次登录不需要验证码。
- 清除浏览器 Cookie 后，再次登录需要验证码。
- 撤销当前设备后，再次登录需要验证码。
- 撤销全部设备后，所有电脑和手机都要重新验证。
- 数据库中没有保存验证码明文。
- 数据库中没有保存可信设备 token 明文。
- Cookie 有 `HttpOnly`、`Secure`、`SameSite=Lax`。
- 账号密码错误不会发送验证码。

## 15. 最小可上线版本

最小版本建议包含：

- `trusted_devices`
- `login_challenges`
- `login_audit_logs`
- `/api/login` 陌生设备返回 `otp_required`
- `/api/login/verify-otp`
- `login.html` 验证码步骤
- 可信设备 Cookie 90 天有效
- 管理员手机号来自 `CRM_ADMIN_PHONE`

设备管理页面可以放到第二个小版本做。

## 16. 关键决策

本项目第一版建议采用：

```text
JWT 继续保存在 localStorage
可信设备使用 HttpOnly Cookie
账号密码仍使用 CRM_USERNAME / CRM_PASSWORD
手机号优先使用 users.phone，兜底使用 CRM_ADMIN_PHONE
短信服务先抽象函数，生产环境接阿里云短信
可信设备有效期 90 天
验证码有效期 5 分钟
```

这样最贴合当前项目，改动可控，也能达到你要的“自己设备不用验证，陌生设备验证手机”的效果。
