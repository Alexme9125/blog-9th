/* eslint-disable @next/next/no-img-element -- Controlled media must bypass the public image optimizer cache. */
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { PageBlock, Member } from "@/lib/content/types";
import { RichText, safeUrl } from "./RichText";
import { MemberList } from "./MemberList";
import styles from "./Site.module.css";
export function PageBlocks({
  blocks,
  members,
}: {
  blocks: PageBlock[];
  members: Member[];
}) {
  return (
    <div className={styles.pageBlocks}>
      {blocks.map((b) => (
        <section key={b.id} className={styles.pageBlock}>
          {b.title && <h2>{b.title}</h2>}
          {b.type === "richtext" && b.body && <RichText doc={b.body} />}{" "}
          {b.type === "imageText" && (
            <div
              className={styles.imageText}
              style={b.imageSide === "right" ? { direction: "rtl" } : undefined}
            >
              {b.imageUrl && safeUrl(b.imageUrl) && (
                <img src={b.imageUrl} alt={b.imageAlt || ""} />
              )}
              <div style={{ direction: "ltr" }}>
                {b.body && <RichText doc={b.body} />}
              </div>
            </div>
          )}
          {b.type === "gallery" && (
            <div className={styles.gallery}>
              {b.images
                ?.filter((i) => safeUrl(i.url))
                .map((i, n) => (
                  <figure key={n}>
                    <img src={i.url} alt={i.alt} loading="lazy" />
                    {i.caption && <figcaption>{i.caption}</figcaption>}
                  </figure>
                ))}
            </div>
          )}
          {b.type === "members" && (
            <MemberList
              members={
                b.memberIds?.length
                  ? members.filter((m) => b.memberIds?.includes(m.id))
                  : members
              }
            />
          )}{" "}
          {b.type === "links" && (
            <div className={styles.linksList}>
              {b.links
                ?.filter((l) => safeUrl(l.url))
                .map((l) => (
                  <Link key={l.url} href={l.url}>
                    <div>
                      <strong>{l.label}</strong>
                      {l.description && <p>{l.description}</p>}
                    </div>
                    <ArrowUpRight size={21} />
                  </Link>
                ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
