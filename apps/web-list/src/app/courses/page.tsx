'use client';

/**
 * 코스 등록부 (지시서 6장 3절 — 이 사이트의 중심 기능).
 *
 * - 공식 코스 (GET /courses): 이름·구간 수·난이도 계수.
 * - 후보 코스 (GET /courses/proposals): 승격 현황 "현재 N명 / 100명" 진행 바.
 * - 후보 코스에서는 코인이 생성되지 않음을 명시.
 * - 새 코스 제안·완주 기록 제출은 지갑 앱에서 (이 페이지는 열람 전용).
 */
import { useEffect, useState } from 'react';
import {
  difficultyRange,
  fetchCourses,
  fetchProposals,
  type CourseData,
  type CourseProposal,
} from '@/lib/api';
import { useI18n } from '@/i18n';

export default function CoursesPage() {
  const { t } = useI18n();
  const [courses, setCourses] = useState<CourseData[] | null>(null);
  const [proposals, setProposals] = useState<CourseProposal[] | null>(null);
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [courseList, proposalList] = await Promise.all([
          fetchCourses(),
          fetchProposals(),
        ]);
        if (!cancelled) {
          setCourses(courseList);
          setProposals(proposalList);
          setServerDown(false);
        }
      } catch {
        if (!cancelled) {
          setCourses([]);
          setProposals([]);
          setServerDown(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const s = t.courses;
  // 승격된 제안은 GET /courses에도 나타나므로 후보만 진행 바로 보여준다.
  const candidates = (proposals ?? []).filter((p) => p.status === 'CANDIDATE');

  return (
    <>
      <h1>{s.title}</h1>
      <p className="muted">{s.intro}</p>

      <div className="notice">{s.submitInApp}</div>
      {serverDown && <div className="notice-warn">{t.common.serverUnreachable}</div>}

      <h2>{s.officialTitle}</h2>
      {courses === null ? (
        <p className="muted">{t.common.loading}</p>
      ) : courses.length === 0 ? (
        !serverDown && <p className="muted">{s.officialEmpty}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>{s.colName}</th>
              <th>{s.colSegments}</th>
              <th>{s.colDifficulty}</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.courseId}>
                <td>
                  {c.name} <span className="badge badge-strong">{s.statusOfficial}</span>
                </td>
                <td>{s.segmentsValue(c.segments.length)}</td>
                <td>{s.difficultyValue(difficultyRange(c.segments))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>{s.candidateTitle}</h2>
      <div className="notice-warn">{s.candidateNoMint}</div>
      {proposals === null ? (
        <p className="muted">{t.common.loading}</p>
      ) : candidates.length === 0 ? (
        !serverDown && <p className="muted">{s.candidateEmpty}</p>
      ) : (
        candidates.map((p) => {
          const pct = Math.min(100, (p.completions / p.promotionThreshold) * 100);
          return (
            <div className="card" key={p.courseId}>
              <h3 style={{ margin: '0 0 0.4rem' }}>
                {p.name} <span className="badge">{s.statusCandidate}</span>
              </h3>
              <div className="progress-row">
                <div
                  className="progress"
                  style={{ flex: 1 }}
                  role="progressbar"
                  aria-valuenow={p.completions}
                  aria-valuemin={0}
                  aria-valuemax={p.promotionThreshold}
                >
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="muted">
                  {s.progressLabel(p.completions, p.promotionThreshold)}
                </span>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
