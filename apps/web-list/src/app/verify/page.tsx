'use client';

/**
 * 위폐 감지기 (M16) — 다니엘 쌤 2026-07-26:
 * "쉬빌 코인 사이트에 코인을 업로드하면 이것이 위조 쉬빌 코인인지 아닌지 확인할 수
 *  있는 방식으로 디자인해보자."
 *
 * ★설계 원칙: 검사는 **전부 브라우저 안에서** 이루어진다. @shvil/shared의
 * checkAuthenticity는 순수 함수라 서버가 없어도, 쉬빌 서버가 사라져도 동작한다 —
 * 개발자도 판정을 통제할 수 없다. 코인은 어떤 서버로도 전송되지 않는다.
 *
 * 판정 축 (docs/위폐감지기_설계.md):
 *  1. 서명·계보 (verifyCoin)
 *  2. 코인 한 장 안의 물리 정합 (속도·보폭·케이던스·발행 요율·일일 상한)
 *  3. ★코인들 사이의 시간 거리 — 복제 프로그램은 코인 사이에 시간을 만들어 넣을 수 없다
 *  4. 통계적 균일성 — 정황일 뿐, 절대 단독으로 위조 판정하지 않는다
 */
import { useRef, useState } from 'react';
import {
  checkAuthenticity,
  parseCheckerInput,
  type AuthenticityReport,
} from '@shvil/shared';
import { fmtShv } from '@/lib/api';
import { useI18n } from '@/i18n';

export default function VerifyPage() {
  const { t } = useI18n();
  const v = t.verify;
  const [input, setInput] = useState('');
  const [report, setReport] = useState<AuthenticityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function runCheck(text: string) {
    setError(null);
    setReport(null);
    try {
      const { coins } = parseCheckerInput(text);
      // 신뢰 키 목록 없이 검사한다 — 서명·물리·시간 거리는 키 없이도 완결되고,
      // 발행자 신원 미확인은 리포트 notes에 정직하게 남는다.
      setReport(checkAuthenticity(coins));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setInput(text);
    runCheck(text);
  }

  const verdictClass: Record<AuthenticityReport['verdict'], string> = {
    FORGED: 'verdict-forged',
    SUSPECT: 'verdict-suspect',
    AUTHENTIC: 'verdict-authentic',
    INCONCLUSIVE: 'verdict-inconclusive',
  };

  return (
    <>
      <h1>{v.title}</h1>
      <p className="muted page-intro">{v.intro}</p>
      <p className="privacy-note">🔒 {v.privacyNote}</p>

      <div className="card">
        <textarea
          className="verify-input"
          rows={8}
          value={input}
          placeholder={v.pastePlaceholder}
          onChange={(e) => setInput(e.target.value)}
          dir="ltr"
        />
        <div className="verify-actions">
          <button className="btn" onClick={() => runCheck(input)} disabled={!input.trim()}>
            {v.checkButton}
          </button>
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
            {v.uploadLabel}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.txt,application/json,text/plain"
            style={{ display: 'none' }}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {(input || report || error) && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                setInput('');
                setReport(null);
                setError(null);
                if (fileRef.current) fileRef.current.value = '';
              }}
            >
              {v.clearButton}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="card verify-error" role="alert">
          <strong>{v.errorPrefix}:</strong> {error}
        </div>
      )}

      {report && (
        <section className="card verify-report">
          <div className={`verify-verdict ${verdictClass[report.verdict]}`}>
            <span className="verdict-label">{v.summaryTitle}</span>
            <span className="verdict-value">{v.verdicts[report.verdict]}</span>
          </div>
          <p className="verify-stats">
            {v.statsLine(report.proofCount, report.grantCount, fmtShv(report.totalDshv))}
          </p>
          {/* 판정 상세는 코어(@shvil/shared)가 한국어로 생성한다. */}
          <p className="verify-summary" lang="ko" dir="ltr">
            {report.summary}
          </p>
          {v.detailsLangNote && <p className="muted">{v.detailsLangNote}</p>}

          {report.findings.length > 0 && (
            <>
              <h2>{v.findingsTitle}</h2>
              <ul className="verify-findings">
                {report.findings.map((f, i) => (
                  <li key={i} className={f.severity === 'FATAL' ? 'finding-fatal' : 'finding-signal'}>
                    <span className={`badge ${f.severity === 'FATAL' ? 'badge-warn' : ''}`}>
                      {f.severity === 'FATAL' ? v.fatalBadge : v.signalBadge}
                    </span>{' '}
                    <span lang="ko" dir="ltr">{f.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {report.notes.length > 0 && (
            <>
              <h2>{v.notesTitle}</h2>
              <ul className="verify-notes">
                {report.notes.map((n, i) => (
                  <li key={i} lang="ko" dir="ltr">
                    {n}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2>{v.serialsTitle}</h2>
          <ul className="verify-serials">
            {report.serials.map((s, i) => (
              <li key={i}>
                <code>{s}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
