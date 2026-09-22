/* eslint-disable @next/next/no-img-element -- Controlled media must bypass the public image optimizer cache. */
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Pencil,
  ArrowUp,
  ArrowDown,
  Copy,
  Upload,
  Check,
  KeyRound,
} from "lucide-react";
import type {
  AdminUser,
  Member,
  MemberInput,
  MediaItem,
  SiteSettings,
  TaxonomyData,
  Taxonomy,
  UserInput,
  Role,
} from "@/lib/cms/types";
import { saveTaxonomy, deleteTaxonomy } from "@/lib/cms/taxonomy";
import { saveMember, deleteMember } from "@/lib/cms/members";
import { saveSettings, saveMembersIntro } from "@/lib/cms/settings";
import { saveUser, resetUserPassword } from "@/lib/cms/users";
import { deleteMedia } from "@/lib/cms/media";
import { uploadFile } from "./RichEditor";
import styles from "./Admin.module.css";
import { useDialog } from "./useDialog";
import { SiteAccessSettings } from "./SiteAccessSettings";
import type { getAdminSiteAccess } from "@/lib/site-access/actions";
function Feedback({ error, message }: { error: string; message?: string }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : message ? (
    <p className="form-success" role="status">
      {message}
    </p>
  ) : null;
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialog = useDialog(onClose);
  return (
    <div className={styles.modalBackdrop}>
      <section
        ref={dialog}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div
          className={styles.panelHeading}
          style={{ padding: 0, marginBottom: 22 }}
        >
          <h2>{title}</h2>
          <button
            type="button"
            className={styles.smallButton}
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function TaxonomyManager({ initial }: { initial: TaxonomyData }) {
  const [data, setData] = useState(initial),
    [editing, setEditing] = useState<{
      kind: "category" | "tag";
      item?: Taxonomy;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [removing, setRemoving] = useState<{
      kind: "category" | "tag";
      item: Taxonomy;
    } | null>(null);
  const router = useRouter();
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const result = await saveTaxonomy({
        id: editing.item?.id,
        kind: editing.kind,
        name: String(f.get("name")),
        slug: String(f.get("slug")),
        description: String(f.get("description") || ""),
      });
      if (!result.ok) setError(result.error);
      else {
        const key = editing.kind === "category" ? "categories" : "tags";
        setData((d) => ({
          ...d,
          [key]: [
            ...d[key].filter((t) => t.id !== result.data.id),
            result.data,
          ],
        }));
        setEditing(null);
        router.refresh();
      }
    } catch {
      setError("保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError("");
    try {
      const r = await deleteTaxonomy(removing.item.id, removing.kind);
      if (!r.ok) setError(r.error);
      else {
        const key = removing.kind === "category" ? "categories" : "tags";
        setData((d) => ({
          ...d,
          [key]: d[key].filter((t) => t.id !== removing.item.id),
        }));
        setRemoving(null);
        router.refresh();
      }
    } catch {
      setError("删除失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className={styles.pageHeading}>
        <div>
          <span className="eyebrow">ORGANIZE YOUR IDEAS</span>
          <h1>分类与标签</h1>
          <p>让记录有迹可循，让相关的想法彼此相遇。</p>
        </div>
      </header>
      <div className={styles.managementGrid}>
        {(["category", "tag"] as const).map((kind) => (
          <section className={styles.panel} key={kind}>
            <div className={styles.panelHeading}>
              <h2>{kind === "category" ? "文章分类" : "内容标签"}</h2>
              <button
                className={styles.smallButton}
                onClick={() => {
                  setError("");
                  setEditing({ kind });
                }}
              >
                <Plus size={14} />
                新建
              </button>
            </div>
            {data[kind === "category" ? "categories" : "tags"].map((t) => (
              <div key={t.id} className={styles.taxonomyRow}>
                <div>
                  <strong>{t.name}</strong>
                  <small>/{t.slug}</small>
                  {t.description && <p>{t.description}</p>}
                </div>
                <div className={styles.rowActions}>
                  <button
                    aria-label={"编辑" + t.name}
                    onClick={() => {
                      setError("");
                      setEditing({ kind, item: t });
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    aria-label={"删除" + t.name}
                    onClick={() => {
                      setError("");
                      setRemoving({ kind, item: t });
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
            {!data[kind === "category" ? "categories" : "tags"].length && (
              <p className={styles.inlineEmpty}>
                还没有{kind === "category" ? "分类" : "标签"}。
              </p>
            )}
          </section>
        ))}
      </div>
      {editing && (
        <Modal
          title={
            (editing.item ? "编辑" : "新建") +
            (editing.kind === "category" ? "分类" : "标签")
          }
          onClose={() => setEditing(null)}
        >
          <form onSubmit={save} className={styles.loginForm}>
            <div className="field">
              <label>
                名称
                <input
                  name="name"
                  defaultValue={editing.item?.name}
                  required
                  maxLength={80}
                />
              </label>
            </div>
            <div className="field">
              <label>
                地址标识
                <input
                  name="slug"
                  defaultValue={editing.item?.slug}
                  required
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder="例如 natural-science"
                />
              </label>
            </div>
            {editing.kind === "category" && (
              <div className="field">
                <label>
                  分类简介
                  <textarea
                    name="description"
                    defaultValue={editing.item?.description}
                  />
                </label>
              </div>
            )}
            <Feedback error={error} />
            <button className="button" disabled={busy}>
              {busy ? "保存中…" : "保存"}
            </button>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal
          title={"删除“" + removing.item.name + "”？"}
          onClose={() => setRemoving(null)}
        >
          <p>仍被文章引用的分类或标签无法删除，请先调整文章设置。</p>
          <Feedback error={error} />
          <div className={styles.modalActions}>
            <button
              className="button secondary"
              onClick={() => setRemoving(null)}
            >
              取消
            </button>
            <button className="button danger" disabled={busy} onClick={remove}>
              确认删除
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
const emptyMember: MemberInput = {
  name: "",
  role: "",
  bio: "",
  avatarUrl: null,
  interests: [],
  links: [],
  order: 0,
};
export function MembersManager({
  initial,
  intro,
}: {
  initial: Member[];
  intro: string;
}) {
  const [members, setMembers] = useState(initial),
    [editing, setEditing] = useState<MemberInput | null>(null),
    [removing, setRemoving] = useState<Member | null>(null),
    [introText, setIntroText] = useState(intro),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      const result = await saveMember(editing);
      if (!result.ok) setError(result.error);
      else {
        setMembers((m) =>
          [...m.filter((x) => x.id !== result.data.id), result.data].sort(
            (a, b) => a.order - b.order,
          ),
        );
        setEditing(null);
        setMessage("成员资料已保存");
        router.refresh();
      }
    } catch {
      setError("保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      const r = await deleteMember(removing.id);
      if (!r.ok) setError(r.error);
      else {
        setMembers((m) => m.filter((x) => x.id !== removing.id));
        setRemoving(null);
        router.refresh();
      }
    } catch {
      setError("删除失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function saveIntro() {
    setError("");
    setBusy(true);
    try {
      const r = await saveMembersIntro(introText);
      if (!r.ok) setError(r.error);
      else {
        setMessage("成员页简介已保存");
        router.refresh();
      }
    } catch {
      setError("保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className={styles.pageHeading}>
        <div>
          <span className="eyebrow">THE PEOPLE / DARWIN</span>
          <h1>主要成员</h1>
          <p>公开成员资料独立于后台账号，可分别维护。</p>
        </div>
        <button
          className="button"
          onClick={() => {
            setError("");
            setEditing({ ...emptyMember, order: members.length });
          }}
        >
          <Plus size={17} />
          添加成员
        </button>
      </header>
      <section className={styles.panel + " " + styles.formPanel}>
        <div className="field">
          <label htmlFor="members-intro">成员页简介</label>
          <textarea
            id="members-intro"
            value={introText}
            onChange={(e) => setIntroText(e.target.value)}
          />
        </div>
        <div className={styles.formActions}>
          <Feedback
            error={!editing && !removing ? error : ""}
            message={message}
          />
          <button
            className="button secondary"
            disabled={busy}
            onClick={saveIntro}
          >
            保存简介
          </button>
        </div>
      </section>
      <div style={{ marginTop: 25 }}>
        {members.map((m) => (
          <article key={m.id} className={styles.memberAdminCard}>
            <div className={styles.memberAvatar}>
              {m.avatarUrl ? (
                <img src={m.avatarUrl} alt={m.name} />
              ) : (
                m.name.slice(0, 1)
              )}
            </div>
            <div>
              <h2>{m.name}</h2>
              <small>
                {m.role} · 排序 {m.order}
              </small>
              <p>{m.bio}</p>
            </div>
            <div className={styles.rowActions}>
              <button
                aria-label={"编辑" + m.name}
                onClick={() => {
                  setError("");
                  setEditing(m);
                }}
              >
                <Pencil size={15} />
              </button>
              <button
                aria-label={"删除" + m.name}
                onClick={() => {
                  setError("");
                  setRemoving(m);
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <Modal
          title={editing.id ? "编辑成员" : "添加成员"}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={save} className={styles.loginForm}>
            <div className={styles.formGrid}>
              <div className="field">
                <label>
                  姓名
                  <input
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                    required
                  />
                </label>
              </div>
              <div className="field">
                <label>
                  职务或研究方向
                  <input
                    value={editing.role}
                    onChange={(e) =>
                      setEditing({ ...editing, role: e.target.value })
                    }
                    required
                  />
                </label>
              </div>
            </div>
            <div className="field">
              <label>
                简介
                <textarea
                  value={editing.bio}
                  onChange={(e) =>
                    setEditing({ ...editing, bio: e.target.value })
                  }
                  required
                />
              </label>
            </div>
            <div className="field">
              <label>
                兴趣（用逗号分隔）
                <input
                  defaultValue={editing.interests.join("，")}
                  onBlur={(e) =>
                    setEditing({
                      ...editing,
                      interests: e.target.value
                        .split(/[,，]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
            </div>
            <div className={styles.formGrid}>
              <div className="field">
                <label>
                  排序
                  <input
                    type="number"
                    value={editing.order}
                    onChange={(e) =>
                      setEditing({ ...editing, order: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <label className={styles.uploadButton}>
                {editing.avatarUrl ? "更换头像" : "上传头像"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      try {
                        const m = await uploadFile(f);
                        setEditing({ ...editing, avatarUrl: m.url });
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "上传失败");
                      }
                  }}
                />
              </label>
            </div>
            <div className="field">
              <label>
                公开链接名称
                <input
                  value={editing.links[0]?.label || ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      links: [
                        {
                          label: e.target.value,
                          url: editing.links[0]?.url || "",
                        },
                      ],
                    })
                  }
                />
              </label>
            </div>
            <div className="field">
              <label>
                公开链接地址
                <input
                  value={editing.links[0]?.url || ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      links: e.target.value
                        ? [
                            {
                              label: editing.links[0]?.label || "个人主页",
                              url: e.target.value,
                            },
                          ]
                        : [],
                    })
                  }
                  placeholder="https://…"
                />
              </label>
            </div>
            <Feedback error={error} />
            <button className="button" disabled={busy}>
              {busy ? "保存中…" : "保存成员资料"}
            </button>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal
          title={"删除成员“" + removing.name + "”？"}
          onClose={() => setRemoving(null)}
        >
          <p>这会移除公开介绍，不会删除任何后台账号。</p>
          <Feedback error={error} />
          <button className="button danger" disabled={busy} onClick={remove}>
            确认删除
          </button>
        </Modal>
      )}
    </>
  );
}
export function SettingsManager({
  initial,
  access,
}: {
  initial: SiteSettings;
  access: Awaited<ReturnType<typeof getAdminSiteAccess>>;
}) {
  const [data, setData] = useState(initial),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  function navUpdate(
    id: string,
    patch: Partial<SiteSettings["navigation"][number]>,
  ) {
    setData((d) => ({
      ...d,
      navigation: d.navigation.map((n) =>
        n.id === id ? { ...n, ...patch } : n,
      ),
    }));
  }
  function move(i: number, d: number) {
    const nav = [...data.navigation];
    [nav[i], nav[i + d]] = [nav[i + d], nav[i]];
    setData({
      ...data,
      navigation: nav.map((n, index) => ({ ...n, order: index })),
    });
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await saveSettings(data);
      if (!r.ok) setError(r.error);
      else {
        setData(r.data);
        setMessage("站点设置已保存");
        router.refresh();
      }
    } catch {
      setError("保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className={styles.pageHeading}>
        <div>
          <span className="eyebrow">THE SHAPE OF OUR COMMUNITY</span>
          <h1>站点设置</h1>
          <p>维护社团的名称、标语与访问入口。</p>
        </div>
      </header>
      <SiteAccessSettings initial={access} />
      <form onSubmit={submit} className={styles.settingsSections}>
        <section className={styles.panel + " " + styles.formPanel}>
          <h2>社团信息</h2>
          <div className={styles.formGrid}>
            <div className="field">
              <label htmlFor="site-name">社团名称</label>
              <input
                id="site-name"
                value={data.name}
                onChange={(e) => setData({ ...data, name: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="site-slogan">社团标语</label>
              <input
                id="site-slogan"
                value={data.slogan}
                onChange={(e) => setData({ ...data, slogan: e.target.value })}
                required
                maxLength={100}
              />
            </div>
            <div className={"field " + styles.fullWidth}>
              <label htmlFor="site-description">社团简介</label>
              <textarea
                id="site-description"
                value={data.description}
                onChange={(e) =>
                  setData({ ...data, description: e.target.value })
                }
              />
            </div>
            <div className={"field " + styles.fullWidth}>
              <label htmlFor="site-footer">页尾文字</label>
              <input
                id="site-footer"
                value={data.footer}
                onChange={(e) => setData({ ...data, footer: e.target.value })}
              />
            </div>
          </div>
        </section>
        <section className={styles.panel + " " + styles.formPanel}>
          <h2>顶部导航</h2>
          <p className={styles.fieldHint}>
            首页与主要成员为固定入口。其他条目可以链接已发布的站内页面、分类或外部网站。
          </p>
          {data.navigation.map((n, i) => (
            <div className={styles.navRow} key={n.id}>
              <input
                aria-label="导航名称"
                value={n.label}
                disabled={n.fixed}
                onChange={(e) => navUpdate(n.id, { label: e.target.value })}
                required
              />
              <input
                aria-label="导航地址"
                value={n.href}
                disabled={n.fixed}
                onChange={(e) => navUpdate(n.id, { href: e.target.value })}
                required
              />
              <div className={styles.navControls}>
                <button
                  type="button"
                  aria-label={"上移" + n.label}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  aria-label={"下移" + n.label}
                  disabled={i === data.navigation.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={15} />
                </button>
                {n.fixed ? (
                  <span className={styles.status}>固定</span>
                ) : (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={n.visible}
                        onChange={(e) =>
                          navUpdate(n.id, { visible: e.target.checked })
                        }
                      />
                      显示
                    </label>
                    <button
                      type="button"
                      aria-label={"删除导航" + n.label}
                      onClick={() =>
                        setData({
                          ...data,
                          navigation: data.navigation
                            .filter((x) => x.id !== n.id)
                            .map((x, index) => ({ ...x, order: index })),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            className={styles.smallButton}
            style={{ marginTop: 18 }}
            onClick={() =>
              setData({
                ...data,
                navigation: [
                  ...data.navigation,
                  {
                    id: crypto.randomUUID(),
                    label: "",
                    href: "",
                    visible: true,
                    order: data.navigation.length,
                  },
                ],
              })
            }
          >
            <Plus size={14} />
            添加导航链接
          </button>
        </section>
        <div className={styles.formActions}>
          <Feedback error={error} message={message} />
          <button className="button" disabled={busy}>
            {busy ? "正在保存…" : "保存站点设置"}
          </button>
        </div>
      </form>
    </>
  );
}
export function UsersManager({
  initial,
  currentUserId,
}: {
  initial: AdminUser[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState(initial),
    [editing, setEditing] = useState<UserInput | null>(null),
    [reset, setReset] = useState<AdminUser | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      const r = await saveUser(editing);
      if (!r.ok) setError(r.error);
      else {
        setUsers((u) => [...u.filter((x) => x.id !== r.data.id), r.data]);
        setEditing(null);
        setMessage("账号已保存。新账号首次登录需修改临时密码。");
        router.refresh();
      }
    } catch {
      setError("保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function resetPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reset) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await resetUserPassword(reset.id, String(f.get("password")));
      if (!r.ok) setError(r.error);
      else {
        setReset(null);
        setMessage("密码已重置，旧会话已失效。请将临时密码单独交给该成员。");
        router.refresh();
      }
    } catch {
      setError("重置失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className={styles.pageHeading}>
        <div>
          <span className="eyebrow">PEOPLE & PERMISSIONS</span>
          <h1>账号管理</h1>
          <p>为成员提供恰当的创作权限。网站不开放读者注册。</p>
        </div>
        <button
          className="button"
          onClick={() => {
            setError("");
            setEditing({ name: "", email: "", role: "author", password: "" });
          }}
        >
          <Plus size={17} />
          创建账号
        </button>
      </header>
      <Feedback error={!editing && !reset ? error : ""} message={message} />
      <section className={styles.panel}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>成员</th>
                <th>角色</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.name}
                    {u.id === currentUserId ? "（你）" : ""}
                    <small>{u.email}</small>
                  </td>
                  <td>
                    {
                      { admin: "管理员", editor: "编辑", author: "作者" }[
                        u.role
                      ]
                    }
                  </td>
                  <td>
                    <span className={styles.status}>
                      {u.disabled
                        ? "已停用"
                        : u.mustChangePassword
                          ? "需更改密码"
                          : "正常"}
                    </span>
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        onClick={() => {
                          setError("");
                          setEditing(u);
                        }}
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => {
                          setError("");
                          setReset(u);
                        }}
                      >
                        <KeyRound size={13} />
                        重置密码
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && (
        <Modal
          title={editing.id ? "编辑账号" : "创建账号"}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={submit} className={styles.loginForm}>
            <div className="field">
              <label>
                姓名
                <input
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  required
                />
              </label>
            </div>
            <div className="field">
              <label>
                邮箱
                <input
                  type="email"
                  value={editing.email}
                  onChange={(e) =>
                    setEditing({ ...editing, email: e.target.value })
                  }
                  required
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="field">
              <label>
                角色
                <select
                  value={editing.role}
                  onChange={(e) =>
                    setEditing({ ...editing, role: e.target.value as Role })
                  }
                >
                  <option value="author">作者 · 撰写自己的文章</option>
                  <option value="editor">编辑 · 审核与发布内容</option>
                  <option value="admin">管理员 · 管理整个站点</option>
                </select>
              </label>
            </div>
            {!editing.id && (
              <div className="field">
                <label>
                  临时密码（至少 12 位）
                  <input
                    type="password"
                    value={editing.password || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, password: e.target.value })
                    }
                    required
                    minLength={12}
                    autoComplete="new-password"
                  />
                </label>
              </div>
            )}
            {editing.id && (
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={editing.disabled || false}
                  onChange={(e) =>
                    setEditing({ ...editing, disabled: e.target.checked })
                  }
                />
                停用账号并撤销会话
              </label>
            )}
            <Feedback error={error} />
            <button className="button" disabled={busy}>
              {busy ? "保存中…" : "保存账号"}
            </button>
          </form>
        </Modal>
      )}
      {reset && (
        <Modal
          title={"重置 " + reset.name + " 的密码"}
          onClose={() => setReset(null)}
        >
          <form onSubmit={resetPassword} className={styles.loginForm}>
            <p className={styles.fieldHint}>
              旧会话将全部失效，成员下次登录需要更换临时密码。
            </p>
            <div className="field">
              <label>
                新的临时密码
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  required
                  autoComplete="new-password"
                />
              </label>
            </div>
            <Feedback error={error} />
            <button className="button" disabled={busy}>
              重置密码
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function MediaManager({ initial }: { initial: MediaItem[] }) {
  const [items, setItems] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(""),
    [removing, setRemoving] = useState<MediaItem | null>(null);
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setBusy(true);
    setError("");
    for (const f of files) {
      try {
        const m = await uploadFile(f);
        setItems((i) => [m, ...i]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "上传失败");
        break;
      }
    }
    setBusy(false);
    e.target.value = "";
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError("");
    try {
      const r = await deleteMedia(removing.id);
      if (!r.ok) setError(r.error);
      else {
        setItems((i) => i.filter((m) => m.id !== removing.id));
        setRemoving(null);
      }
    } catch {
      setError("删除失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className={styles.pageHeading}>
        <div>
          <span className="eyebrow">IMAGES & MATERIALS</span>
          <h1>媒体库</h1>
          <p>图片先私密保存，被公开内容引用后才可匿名访问。</p>
        </div>
        <label className={styles.uploadButton}>
          <Upload size={16} />
          {busy ? "正在上传…" : "上传图片"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            disabled={busy}
            onChange={upload}
          />
        </label>
      </header>
      <Feedback error={!removing ? error : ""} />
      <div className={styles.mediaGrid}>
        {items.map((m) => (
          <article key={m.id} className={styles.mediaCard}>
            <div className={styles.mediaImage}>
              <img src={m.url} alt={m.alt || m.filename} loading="lazy" />
            </div>
            <div className={styles.mediaDetails}>
              <h3>{m.filename}</h3>
              <p>
                {m.width} × {m.height} / {Math.round(m.size / 1024)} KB
              </p>
              <div>
                <button
                  className={styles.smallButton}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(m.url);
                      setCopied(m.id);
                    } catch {
                      setError(
                        "无法写入剪贴板，请在编辑器中重新选择或上传图片。",
                      );
                    }
                  }}
                >
                  {copied === m.id ? <Check size={12} /> : <Copy size={12} />}
                  复制地址
                </button>
                <button
                  className={styles.smallButton}
                  onClick={() => {
                    setError("");
                    setRemoving(m);
                  }}
                >
                  <Trash2 size={12} />
                  删除
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!items.length && (
        <div className="empty-state">
          <h3>把第一张图片带到这里。</h3>
          <p>支持 JPG、PNG、WebP、AVIF，每张不超过 12 MB。</p>
        </div>
      )}
      {removing && (
        <Modal title="删除这张图片？" onClose={() => setRemoving(null)}>
          <p>仍被内容引用的图片不能删除。未引用图片删除后无法恢复。</p>
          <Feedback error={error} />
          <button className="button danger" disabled={busy} onClick={remove}>
            确认删除
          </button>
        </Modal>
      )}
    </>
  );
}
