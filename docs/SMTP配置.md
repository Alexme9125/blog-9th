# SMTP 配置与邮件队列

邮件功能默认关闭。管理员在 `/admin/mail` 保存并启用 SMTP 之前，站点不会创建订阅、文章推送或申请通知的邮件任务。

## 升级已有部署

本次功能包含数据库迁移，不能只重建 `app` 容器。拉取包含本功能的版本后，使用完整 Compose 启动流程，让一次性的 `migrate` 服务先完成迁移：

```bash
git pull --ff-only
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 migrate app
```

本地开发则在数据库已启动后执行：

```bash
pnpm db:migrate
pnpm dev
```

## 管理员设置

在“邮件设置”中填写以下内容：

- 启用开关；关闭时新的邮件不会进入队列，已存在的任务会暂停，不会外发。
- SMTP 主机、端口、用户名和密码。
- 加密方式：`TLS` 用于一建立连接就加密的 SMTP（通常为 465）；`STARTTLS` 用于连接后升级加密的 SMTP（通常为 587）。两种方式都要求 TLS，服务器不能升级 STARTTLS 时会失败；证书校验和 TLS 1.2 最低版本始终开启。
- 发件人名称、发件人邮箱，以及可选的回复邮箱。邮箱地址和邮件头中的换行符都会在保存时校验，避免邮件头注入。
- 可选的申请通知收件邮箱。
- “文章发布后自动通知”开关默认关闭；“允许手动推送”默认开启。这两个开关相互独立。

SMTP 密码不会回传到浏览器。编辑时把密码框留空会保留当前密码；只有勾选“清除密码”才会删除它。启用 SMTP 时必须有用户名和密码。

“发送测试邮件”只会创建一条一次性的 `test` outbox 任务，然后唤醒一个有超时和并发上限的 worker；浏览器请求本身不会直接连接 SMTP。投递历史只显示掩码后的收件人、状态和通用错误码，不显示正文、地址、SMTP 主机或密码。

## 本地 TLS 验收

本地使用测试 SMTP 时，只使用回环地址和测试邮箱，例如 `to@example.test`，不要填写外部可投递邮箱。若测试服务器使用内部 CA 或自签名证书，必须在 **启动 Node 进程之前** 信任该 CA：

```bash
NODE_EXTRA_CA_CERTS=/absolute/path/to/local-smtp-ca.pem pnpm dev
```

在后台填写 `localhost`（或回环测试主机）、本地端口和 `TLS`，保存启用后发送测试邮件。测试动作会立即触发一个单批 worker；开发模式不会常驻 15 秒定时器。生产 Node 服务在 Next instrumentation 启动时每 15 秒检查一次队列。构建和测试环境不会创建该定时器。

## 队列与撤回

每位收件人都有独立且带去重键的数据库任务。worker 用数据库行租约和 `SKIP LOCKED` 领取任务，进程重启或崩溃后，过期租约会重试。失败采用有上限的指数退避；历史仅保存诸如 `SMTP_TLS_FAILED`、`SMTP_TIMEOUT` 的通用错误码，不写入 SMTP 返回文本或地址。

SMTP 协议无法在“远端服务已接受邮件、本站尚未来得及写入 sent 状态”的崩溃窗口中提供跨服务的严格 exactly-once 保证。稳定的 Message-ID 和业务去重键会降低重复风险；系统优先保证不会悄悄丢失已提交的任务。

投递前会再次检查状态：已退订的订阅者、已撤回或不再公开的文章，以及已撤回或未验证的申请都不会再收到相应邮件。申请邮箱所有权验证邮件是唯一允许在申请尚未验证时投递的申请邮件。

## 密钥轮换

SMTP 密码使用 AES-256-GCM 加密，密钥通过 HKDF 从稳定的 `BETTER_AUTH_SECRET`（兼容旧的 `AUTH_SECRET`）派生；密码不会以明文存入数据库。不要无计划地更换该密钥，因为旧密文将无法读取。

需要轮换时：

1. 安全保存旧的 `BETTER_AUTH_SECRET`，将新的值写入 `BETTER_AUTH_SECRET`，并暂时把旧值放入 `MAIL_ENCRYPTION_PREVIOUS_SECRET`。
2. 采用上方的完整部署命令更新服务。管理员登录后打开邮件设置，不填写新密码也不清除密码，直接保存一次；系统会用新密钥重新加密保留的 SMTP 密码。
3. 向本地或内部测试 SMTP 地址发送测试邮件并确认成功。
4. 删除 `MAIL_ENCRYPTION_PREVIOUS_SECRET`，再重建 `app` 容器使该临时轮换桥退出运行环境。

若旧密钥不可得，管理员需要在邮件设置中重新输入 SMTP 密码；不要通过日志、数据库导出或浏览器页面寻找旧密码。

Nodemailer 固定为 `10.0.10`。TLS/STARTTLS 行为依据其官方 [SMTP transport 文档](https://nodemailer.com/smtp)；版本固定依据其官方 [release 页面](https://github.com/nodemailer/nodemailer/releases)。
