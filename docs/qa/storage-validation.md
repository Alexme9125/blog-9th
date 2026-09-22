# Storage validation

Validated on 2026-09-20 against the project-local development PostgreSQL
instance at `127.0.0.1:55432`. Credentials and the complete connection URL
were read only from ignored `.env.local` and are not recorded here.

## Native PostgreSQL backup and recovery

A temporary, project-local PostgreSQL 17.11 client set ran one real recovery
check against database `darwin`. It used a custom-format `pg_dump` with
`--no-owner --no-privileges`, verified the archive with `pg_restore --list`,
then restored it into the isolated database
`darwin_recovery_check_90267_1789835568097`.

| Check | Source | Restored |
| --- | ---: | ---: |
| Public base tables | 15 | 15 |
| Documents where `kind = 'post'` | 7 | 7 |

The dump was 51,038 bytes. The one-off process completed `dropdb` for the
isolated target before reporting success. The source `darwin` database was
not renamed, restored into, or otherwise changed by this check.

## Docker 构建与隔离运行

本机初始没有 Docker。为本次验收在忽略目录 `.data/runtime/` 中配置了项目独立的 Lima 与 Docker 环境，没有修改系统 PATH。标准生产部署仍使用根目录 Dockerfile、Compose 与 Caddy 配置。

- 应用采用 Node.js 24，数据库采用 PostgreSQL 17，Caddy 提供 HTTPS。
- app、migrate、bootstrap 三个 target 已构建并运行；初始化不会导入虚构社团内容。
- Better Auth 运行密钥没有传入构建阶段，构建没有 BetterAuthError。
- 登录与内容管理的 5 项 Playwright 流程已在本地 HTTPS 生产栈通过。
- Caddy 配置通过实际 `caddy validate`，限制媒体上传请求体大小，为应用的 12 MiB 文件限制保留 multipart 开销。
- Dockerfile 将迁移和管理员初始化阶段放在应用构建阶段前方，以支持不跳过无关阶段的 classic builder。

HTTPS 使用本地 Caddy 内部测试证书；仅验收浏览器配置忽略该证书错误，标准公网配置使用正式域名和 Caddy 自动证书。

## 非空数据与图片持久化

在独立 Docker 验收栈内创建明确标注的测试草稿、对应修订与真实 PNG 文件，并注册媒体记录。所有者是隔离验收管理员。该数据没有写入本机开发数据库，也不属于生产初始化逻辑。

记录数据库正文与元数据、媒体 UUID 存储键及文件 SHA-256 后，强制重建 PostgreSQL 和应用容器。重建完成后的核对结果：

| 检查 | 结果 |
| --- | --- |
| 数据库公共表 | 15 张 |
| 指定草稿、修订、媒体记录 | 1 / 1 / 1，均保留 |
| 草稿正文、作者与媒体元数据 | 与重建前一致 |
| 实际 PNG 文件 | 保留，SHA-256 一致 |
| HTTPS `/api/health` | `{"ok":true}` |

图片为用于存储验收的 1×1 PNG；其 SHA-256 为：

```text
5fd4d7e331e0d162bd059c7573860f239ea9340d569f8b037de797c7abbf1b9d
```

## 两轮备份与恢复

对上述非空验收栈实际运行：

1. `scripts/backup.sh` 创建数据库与媒体一致快照。
2. `scripts/restore.sh` 校验归档，在新数据库完成恢复后切换数据库及媒体。
3. 对已经恢复的栈再次执行备份。
4. 再次恢复第二份归档，并核对同一组草稿、修订、媒体记录及图片哈希。

两轮均成功。两份归档权限为 `0600`，都含真实 UUID 命名的 PNG，没有隐藏回滚目录或其他不允许的成员。最终正文、元数据、1 / 1 / 1 条测试记录、图片 SHA-256 与恢复前完全一致，HTTPS 健康检查正常。

恢复会保留旧数据库和隐藏媒体回滚目录。后续备份只从临时副本选取活动 UUID 媒体文件，避免将回滚目录嵌入新的备份；卷中的回滚数据没有被备份脚本删除。脚本使用 `umask 077`，临时归档从创建时即为私有。

验收归档及隔离栈配置保存在被忽略的 `.data/runtime/` 内，包含账号或数据库内容的文件不进入源码或镜像。验收用草稿与 PNG 保留在隔离栈中，用于复核持久化结果。

## 归档输入防护

`scripts/backup.sh`、`scripts/restore.sh` 通过 `bash -n`。以下拒绝行为经过实际检查：

- 拒绝含 `media/../../outside` 的路径穿越归档。
- 拒绝含控制字符的文件名。

脚本另外实现了严格文件清单，只允许约定的清单、数据库 dump、媒体目录和 UUID 图片文件，并拒绝链接、特殊文件和重复条目；这些分支经过代码复核。

恢复前在新临时目录校验归档，并用 PostgreSQL 工具检查 dump。若数据库切换后媒体交换失败，应用保持停止，以免混用不一致的数据；旧数据保留供人工回滚。

## 适用边界

本次完成本地隔离 Docker 栈的实际构建、HTTPS 运行、容器重建与恢复验证。尚未向公网服务器部署；部署者仍需配置真实服务器、域名、网络入口和独立备份保存位置。
