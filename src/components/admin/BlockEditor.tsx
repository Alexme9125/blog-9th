/* eslint-disable @next/next/no-img-element -- Controlled media must bypass the public image optimizer cache. */
"use client";
import { Plus, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import type { PageBlock, Member } from "@/lib/cms/types";
import { RichEditor, uploadFile } from "./RichEditor";
import { useState } from "react";
import styles from "./Admin.module.css";
const names = {
  richtext: "富文本",
  imageText: "图文组合",
  gallery: "图片画廊",
  members: "成员集合",
  links: "链接列表",
};
export function BlockEditor({
  blocks,
  onChange,
  members,
}: {
  blocks: PageBlock[];
  onChange: (blocks: PageBlock[]) => void;
  members: Member[];
}) {
  const [error, setError] = useState("");
  function update(id: string, data: Partial<PageBlock>) {
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...data } : b)));
  }
  function move(index: number, direction: number) {
    const copy = [...blocks];
    [copy[index], copy[index + direction]] = [
      copy[index + direction],
      copy[index],
    ];
    onChange(copy);
  }
  async function upload(id: string, file: File, gallery: boolean) {
    setError("");
    try {
      const media = await uploadFile(file);
      const block = blocks.find((b) => b.id === id)!;
      update(
        id,
        gallery
          ? {
              images: [
                ...(block.images || []),
                { url: media.url, alt: file.name },
              ],
            }
          : { imageUrl: media.url, imageAlt: file.name },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    }
  }
  return (
    <div className={styles.blockEditor}>
      {blocks.map((b, i) => (
        <section key={b.id} className={styles.block}>
          <div className={styles.blockHeading}>
            <span>
              {String(i + 1).padStart(2, "0")} / {names[b.type]}
            </span>
            <div>
              <button
                type="button"
                disabled={i === 0}
                aria-label={"上移模块" + (i + 1)}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                disabled={i === blocks.length - 1}
                aria-label={"下移模块" + (i + 1)}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                aria-label={"删除模块" + (i + 1)}
                onClick={() => onChange(blocks.filter((x) => x.id !== b.id))}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor={"block-title-" + b.id}>模块标题（可选）</label>
            <input
              id={"block-title-" + b.id}
              value={b.title || ""}
              onChange={(e) => update(b.id, { title: e.target.value })}
            />
          </div>
          {(b.type === "richtext" || b.type === "imageText") && (
            <RichEditor
              value={
                b.body || { type: "doc", content: [{ type: "paragraph" }] }
              }
              onChange={(body) => update(b.id, { body })}
            />
          )}{" "}
          {(b.type === "imageText" || b.type === "gallery") && (
            <div className={styles.blockImages}>
              {b.type === "imageText" && b.imageUrl && (
                <div>
                  <img src={b.imageUrl} alt={b.imageAlt || ""} />
                  <div className="field">
                    <label>
                      图片说明
                      <input
                        value={b.imageAlt || ""}
                        onChange={(e) =>
                          update(b.id, { imageAlt: e.target.value })
                        }
                      />
                    </label>
                  </div>
                </div>
              )}
              {b.type === "imageText" && (
                <div className="field">
                  <label>
                    图片位置
                    <select
                      value={b.imageSide || "left"}
                      onChange={(e) =>
                        update(b.id, {
                          imageSide: e.target.value as "left" | "right",
                        })
                      }
                    >
                      <option value="left">左侧</option>
                      <option value="right">右侧</option>
                    </select>
                  </label>
                </div>
              )}
              {b.type === "gallery" &&
                b.images?.map((image, n) => (
                  <div key={n}>
                    <img src={image.url} alt={image.alt} />
                    <div className="field">
                      <label>
                        图片说明
                        <input
                          value={image.alt}
                          onChange={(e) =>
                            update(b.id, {
                              images: b.images?.map((x, j) =>
                                j === n
                                  ? {
                                      ...x,
                                      alt: e.target.value,
                                      caption: e.target.value,
                                    }
                                  : x,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      className={styles.smallButton}
                      onClick={() =>
                        update(b.id, {
                          images: b.images?.filter((_, j) => j !== n),
                        })
                      }
                    >
                      移除图片
                    </button>
                  </div>
                ))}
              <label className={styles.uploadButton}>
                上传图片
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/avif"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(b.id, f, b.type === "gallery");
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          )}
          {b.type === "members" && (
            <div className={styles.checkList}>
              <p className="muted">不勾选时显示全部成员。</p>
              {members.map((m) => (
                <label key={m.id}>
                  <input
                    type="checkbox"
                    checked={b.memberIds?.includes(m.id) || false}
                    onChange={(e) =>
                      update(b.id, {
                        memberIds: e.target.checked
                          ? [...(b.memberIds || []), m.id]
                          : (b.memberIds || []).filter((id) => id !== m.id),
                      })
                    }
                  />
                  {m.name}
                </label>
              ))}
            </div>
          )}
          {b.type === "links" && (
            <div className={styles.linksEditor}>
              {b.links?.map((link, n) => (
                <div key={n} className={styles.linkRow}>
                  <input
                    aria-label="链接名称"
                    placeholder="链接名称"
                    value={link.label}
                    onChange={(e) =>
                      update(b.id, {
                        links: b.links?.map((x, j) =>
                          j === n ? { ...x, label: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label="链接地址"
                    placeholder="https:// 或站内路径"
                    value={link.url}
                    onChange={(e) =>
                      update(b.id, {
                        links: b.links?.map((x, j) =>
                          j === n ? { ...x, url: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label="链接描述"
                    placeholder="描述（可选）"
                    value={link.description || ""}
                    onChange={(e) =>
                      update(b.id, {
                        links: b.links?.map((x, j) =>
                          j === n ? { ...x, description: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    aria-label="移除链接"
                    onClick={() =>
                      update(b.id, {
                        links: b.links?.filter((_, j) => j !== n),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.smallButton}
                onClick={() =>
                  update(b.id, {
                    links: [...(b.links || []), { label: "", url: "" }],
                  })
                }
              >
                ＋ 添加链接
              </button>
            </div>
          )}
        </section>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className={styles.addBlocks}>
        <span>添加模块</span>
        {Object.entries(names).map(([type, name]) => (
          <button
            type="button"
            key={type}
            onClick={() =>
              onChange([
                ...blocks,
                {
                  id: crypto.randomUUID(),
                  type: type as PageBlock["type"],
                  ...(type === "richtext" || type === "imageText"
                    ? {
                        body: { type: "doc", content: [{ type: "paragraph" }] },
                      }
                    : type === "gallery"
                      ? { images: [] }
                      : type === "members"
                        ? { memberIds: [] }
                        : { links: [] }),
                },
              ])
            }
          >
            <Plus size={14} />
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
