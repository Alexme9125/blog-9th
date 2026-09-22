# 生产部署验证记录

验证日期：2026-09-22。此记录覆盖本次发布源码在项目隔离 Docker QA 环境中的部署、首次初始化与恢复流程；未使用本机正式 `.env.local`、真实用户数据或真实管理员凭据。

## 本次部署调整

- `Dockerfile` 使用 BuildKit secret 挂载编译期 `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`，不再将该值写入 Docker `ARG` 或镜像层环境变量。
- `migrator` 与 `bootstrap` 目标以镜像内置 `node` 用户运行；应用运行时继续使用 UID 1001 的 `nextjs` 用户。
- Compose 为应用构建声明 secret、为正常停止设置 30 秒宽限期，并保持密钥只在运行时环境中可用。
- 恢复脚本在交换数据前以 `--network none` 启动只读 `pg_restore --list` 验证容器，避免不可信备份内容访问 Compose 网络。

## 验证结果

| 检查项 | 结果与可复核证据 |
| --- | --- |
| 生产镜像构建 | 通过。使用项目隔离的 BuildKit 构建 `runner`、`migrator`、`bootstrap` 三个目标；Compose 配置接受 BuildKit secret。构建期密钥未作为 Docker `ARG` 或 `ENV` 出现在 Dockerfile 中。 |
| 非 root 运行 | 通过。运行中的应用容器为 `nextjs`，可写 `/app/data/media`，不可写 `/app`；迁移和 bootstrap 目标均为 `node` 用户。 |
| 空数据库首次安装 | 通过。全新命名卷完成迁移后，`user/documents/members/media` 行数为 `0/0/0/0`。显式执行生产 bootstrap 后为 `1/0/0/0`，且生产 bootstrap 目标不包含 `src/lib/cms/seed.ts`；没有写入虚构文章、成员或媒体。 |
| Caddy 与 HTTPS | 通过。根目录 Caddyfile 经 Caddy 2.11.4 配置验证；隔离栈通过 `https://localhost:18443/api/health` 返回 `{"ok":true}`。该地址使用 `tls internal`，浏览器自动化须忽略本地证书错误。 |
| 备份与恢复 | 通过。控制数据生成备份 `darwin-journal-20260922T143324Z.tar.gz` 后，按 `scripts/restore.sh ... --confirm=restore-darwin` 恢复。恢复后 app/db 均 healthy，`user/documents/revisions/media` 行数为 `1/1/1/1`，与恢复前一致；受管媒体文件 SHA-256 仍为 `5fd4d7e331e0d162bd059c7573860f239ea9340d569f8b037de797c7abbf1b9d`。恢复过程保留旧数据库和旧媒体目录，便于人工回退。 |
| 版本与持久化 | 通过。应用、数据库、Caddy 由命名卷隔离持久化；恢复只替换已验证的新数据库和媒体暂存目录，迁移在应用启动前完成。 |

## 交接环境

本次恢复后保留的隔离 HTTPS 栈为 `https://localhost:18443`，供发布前浏览器 E2E 使用。E2E 变量文件和管理员凭据文件均位于项目忽略的 `.data/runtime/` 下，未写入此记录或仓库。经典版的五项 CMS / 可访问性场景通过后，切换 `SITE_EDITION=anniversary-9` 并重建应用容器，周年版 Chromium / WebKit 两项检查同样通过。详见 [发布检查](../release-validation.md)。

## 部署前提

生产主机需要 Docker Engine、Docker Compose v2 和启用 BuildKit 的 Buildx。部署时提供 `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` 作为 Compose build secret，同时在应用运行环境提供同一稳定值；不要把它加入 Dockerfile、镜像标签或构建日志。数据库密码若包含 URL 保留字符，须在 `DATABASE_URL` 的密码段进行百分号编码。

此项为本地隔离环境验证，尚不替代目标域名的 DNS、ACME 证书签发与公网连通性检查；这些应在实际主机使用最终域名完成。
