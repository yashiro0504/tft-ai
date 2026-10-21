/* eslint-disable @next/next/no-img-element */
import Link from 'next/link'
import type { EntityLink, EntityPageData } from '@/lib/entityData'
import { ENTITY_PATH, type EntityKind } from '@/lib/entitySlug'
import { SimpleHeader } from './SimpleHeader'
import { SiteFooter } from './SiteFooter'
import { ShareButton } from './ShareButton'
import '../rank/rank.css'
import '../rank/tabs.css'
import '../deck/deck.css'
import '../entity.css'

/**
 * 기물·아이템·시너지 상세 페이지 공용 본문 (서버 컴포넌트).
 * 데이터는 lib/entityData.ts 가 대시보드와 같은 기본 필터로 만든다.
 */

const KIND_LABEL: Record<EntityKind, string> = { champion: '기물', item: '아이템', trait: '시너지' }

const avg = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? v.toFixed(2) : '-')
const pct = (v: number | null | undefined) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '-')

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rk-ent-tile">
      <span>{label}</span>
      <b>{value}</b>
      {sub ? <small>{sub}</small> : null}
    </div>
  )
}

function LinkRow({ link }: { link: EntityLink }) {
  const s = link.stat
  return (
    <li className={`rk-ent-row${s?.lowSample ? ' is-low' : ''}`}>
      <Link href={`${ENTITY_PATH[link.kind]}/${link.slug}`} className="rk-ent-rowlink">
        <span className="rk-icon">{link.img ? <img src={link.img} alt="" loading="lazy" /> : null}</span>
        <span className="rk-ent-rowname">
          {link.name}
          {link.note ? <em>{link.note}</em> : null}
        </span>
        {s ? (
          <span className="rk-ent-rowstat">
            <b>{avg(s.avgPlacement)}</b>위 · TOP4 {pct(s.top4Rate)} · {s.sampleSize.toLocaleString()}판
            {s.lowSample ? <small className="rk-low">표본 부족</small> : null}
          </span>
        ) : (
          <span className="rk-ent-rowstat dim">통계 없음</span>
        )}
      </Link>
    </li>
  )
}

export function EntityDetail({ data }: { data: EntityPageData }) {
  const s = data.stat
  const path = `${ENTITY_PATH[data.kind]}/${data.slug}`

  return (
    <div className="min-h-screen bg-app text-ink">
      <SimpleHeader active="meta" />

      <div className="rk-shell rk-deck">
        <main className="rk-deck-main">
          <nav className="rk-deck-crumb" aria-label="위치">
            <Link href="/meta">메타 랭킹</Link>
            <span>/</span>
            <span>{KIND_LABEL[data.kind]}</span>
          </nav>

          <header className="rk-deck-hero rk-ent-hero">
            <div className={`rk-ent-icon is-${data.kind}`}>{data.img ? <img src={data.img} alt="" /> : null}</div>
            <div className="rk-ent-head">
              <div className="rk-deck-title">
                <h1>{data.name}</h1>
                {data.badge ? <span className="rk-cost">{data.badge}</span> : null}
              </div>
              <p className="rk-deck-meta">
                {data.filterText}
                {s?.rank ? (
                  <>
                    <span className="rk-sep">/</span>
                    {KIND_LABEL[data.kind]} {s.rankOf}개 중 <b>{s.rank}위</b>
                  </>
                ) : null}
              </p>
              {data.tags.length ? (
                <div className="rk-ent-tags">
                  {data.tags.map((t) => (
                    <Link key={t.slug} href={`${ENTITY_PATH[t.kind]}/${t.slug}`}>
                      {t.img ? <img src={t.img} alt="" loading="lazy" /> : null}
                      {t.name}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </header>

          {s ? (
            <section className="rk-ent-stats" aria-label="통계">
              <StatTile label="평균등수" value={avg(s.avgPlacement)} sub={s.margin ? `±${s.margin.toFixed(2)}` : undefined} />
              <StatTile label="TOP4" value={pct(s.top4Rate)} />
              {typeof s.winRate === 'number' ? <StatTile label="1등" value={pct(s.winRate)} /> : null}
              {typeof s.pickRate === 'number' ? <StatTile label="픽률" value={`${(s.pickRate * 100).toFixed(1)}%`} /> : null}
              <StatTile label="표본" value={`${s.sampleSize.toLocaleString()}판`} />
            </section>
          ) : (
            <p className="rk-ent-note">이 필터에는 아직 통계가 없습니다. 표본이 쌓이면 표시됩니다.</p>
          )}
          {s?.lowSample ? (
            <p className="rk-ent-note">
              표본이 {data.minSample}판 미만이라 순위에서 제외했습니다. 수치는 참고용입니다.
            </p>
          ) : null}

          <section>
            <p className="rk-label">{data.relatedTitle}</p>
            {data.related.length ? (
              <ul className="rk-ent-list">
                {data.related.map((l) => (
                  <LinkRow key={`${l.kind}-${l.slug}`} link={l} />
                ))}
              </ul>
            ) : (
              <p className="rk-ent-note">표본이 아직 없습니다.</p>
            )}
          </section>

          <section>
            <p className="rk-label">{data.kind === 'champion' ? '이 기물이 들어간 덱' : data.kind === 'item' ? '이 아이템이 들어간 덱' : '이 시너지를 쓰는 덱'}</p>
            {data.decks.length ? (
              <ul className="rk-ent-list">
                {data.decks.map((d) => {
                  const body = (
                    <>
                      <span className={`rk-tier rk-t${(d.tier || 'C').toUpperCase()}`}>{(d.tier || '-').toUpperCase()}</span>
                      <span className="rk-ent-rowname">
                        {d.name}
                        {d.fromDb ? <em>DB 집계</em> : null}
                      </span>
                      <span className="rk-ent-rowstat">
                        <b>{avg(d.avgPlacement)}</b>위 · TOP4 {pct(d.top4Rate)} · {d.sampleSize.toLocaleString()}판
                      </span>
                    </>
                  )
                  return (
                    <li key={d.id} className="rk-ent-row">
                      {d.linkable ? (
                        <Link href={`/deck/${d.id}`} className="rk-ent-rowlink">
                          {body}
                        </Link>
                      ) : (
                        <div
                          className="rk-ent-rowlink is-static"
                          title={d.fromDb ? 'DB 집계 덱은 별도 상세 페이지가 없습니다' : '이 덱은 별도 상세 페이지가 없습니다'}
                        >
                          {body}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="rk-ent-note">포함된 메타 덱이 없습니다.</p>
            )}
          </section>

          <div className="rk-deck-actions">
            <ShareButton path={path} label="링크 복사" surface={`${data.kind}_page`} />
            <Link href="/meta" className="rk-deck-link">
              메타 랭킹 전체 보기
            </Link>
          </div>
          <p className="rk-ent-foot">
            {data.source === 'db'
              ? 'KR 랭크 판 누적 집계 (매시간 갱신). 평균등수 ± 는 표준오차입니다.'
              : '빌드 시점 래더 표본 스냅샷입니다. 필터(패치·티어·기간)는 메타 랭킹에서 바꿀 수 있습니다.'}
          </p>
        </main>
      </div>

      <SiteFooter />
    </div>
  )
}
