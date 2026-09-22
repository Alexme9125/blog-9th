/* eslint-disable @next/next/no-img-element -- Controlled media must bypass the public image optimizer cache. */
import type { Member } from "@/lib/content/types";
import { safeUrl } from "./RichText";
import styles from "./Site.module.css";
export function MemberList({ members }: { members: Member[] }) {
  return (
    <div className={styles.membersGrid}>
      {members.map((m) => (
        <article key={m.id} className={styles.member}>
          <div className={styles.memberPortrait}>
            {m.avatarUrl ? (
              <img src={m.avatarUrl} alt={m.name} />
            ) : (
              <span>{m.name.slice(0, 1)}</span>
            )}
          </div>
          <h2>{m.name}</h2>
          <span className={styles.memberRole}>{m.role}</span>
          <p>{m.bio}</p>
          <div className={styles.memberTags}>
            {m.interests.map((i) => (
              <span key={i}># {i}</span>
            ))}
          </div>
          <div className={styles.memberLinks}>
            {m.links
              .filter((l) => safeUrl(l.url))
              .map((l) => (
                <a key={l.url} href={l.url} rel="noopener noreferrer">
                  {l.label} ↗
                </a>
              ))}
          </div>
        </article>
      ))}
    </div>
  );
}
