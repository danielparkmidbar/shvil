'use client';

/**
 * 위폐 감지기 (M16) — 다니엘 쌤 2026-07-26:
 * "위폐 감지기도 각자 다운 받아 사용할 수 있다. 즉 커뮤니티에게 툴을 주고 커뮤니티가
 *  스스로 확인한다. (…) 내가 중앙에서 시스템을 유지하며 뭘 하는 것이 아니다."
 *
 * ★그래서 이 페이지는 **검사를 대행하는 서비스가 아니라 도구를 나눠주는 곳**이다.
 * 여기서 바로 검사해 볼 수도 있지만, 그것은 맛보기다 — 진짜 목적은 감지기 파일을
 * 각자 내려받아 자기 기기에 보관하게 하는 것이다. 이 사이트가 사라져도 감지기는 산다.
 *
 * ★설계 원칙 (헌법 제9조 서버 불간섭):
 *  · 검사는 **전부 브라우저 안에서** 이루어진다. @shvil/shared의 checkAuthenticity는
 *    순수 함수라 서버가 없어도, 쉬빌 서버가 사라져도 동작한다 — 개발자도 판정을
 *    통제할 수 없다. 코인은 어떤 서버로도 전송되지 않는다.
 *  · 제출한 코인이 내 서버로 가면 그것 자체가 감시다. 그래서 이 파일은
 *    **네트워크 통로를 하나도 import하지 않는다** — @/lib/api(서버 클라이언트)조차
 *    쓰지 않는다. import 목록만 보고도 "아무것도 전송되지 않는다"를 확인할 수 있게.
 *
 * 검사 강도는 각자의 손실 위험에 비례해 각자 정한다. 우리는 검사를 강요하지도,
 * 판정을 대신하지도 않는다 (v.effort). 그리고 감지기가 **못 하는 것**을 함께 밝힌다
 * (v.limits — 헌법 제3조 정직화, 과장 금지).
 *
 * 판정 축 (docs/위폐감지기_설계.md):
 *  1. 서명·계보 (verifyCoin)
 *  2. 코인 한 장 안의 물리 정합 (속도·보폭·케이던스·발행 요율·일일 상한)
 *  3. ★코인들 사이의 시간 거리 — 복제 프로그램은 코인 사이에 시간을 만들어 넣을 수 없다
 *  4. 통계적 균일성 — 정황일 뿐, 절대 단독으로 위조 판정하지 않는다
 */
import { useRef, useState } from 'react';
import {
  DSHV_PER_SHV,
  checkAuthenticity,
  parseCheckerInput,
  type AuthenticityReport,
} from '@shvil/shared';
import { useI18n } from '@/i18n';

/**
 * 오프라인 감지기 — 단일 HTML 파일 하나. next.config.ts가 output:'export'라
 * apps/web-list/public/checker.html이 그대로 /checker.html로 나간다.
 *
 * ★이 파일은 이 앱이 만들지 않는다. 원본은 tools/checker/ 이고,
 *    node tools/checker/build.mjs   → tools/checker/배포/쉬빌_위폐감지기.html
 * 로 빌드된 뒤 apps/web-list/public/checker.html 로 **복사되어야** 이 링크가 산다.
 * public/checker.html이 없으면 이 버튼은 404다 — 감지기를 고칠 때마다 다시 빌드하고
 * 다시 복사할 것. (없는 것을 있다고 말하지 않는다 — 헌법 제3조.)
 */
const CHECKER_FILE_URL = '/checker.html';
/** 내려받을 때 저장될 이름 — 사용자가 나중에 알아볼 수 있게. */
const CHECKER_FILE_NAME = 'shvil-checker.html';

/**
 * SHV 표기 — 원래 @/lib/api의 fmtShv를 썼으나, 그 모듈은 서버 클라이언트다.
 * 이 페이지가 네트워크 코드를 아예 import하지 않게 하려고 여기서 직접 만든다.
 * 단위는 @shvil/shared의 DSHV_PER_SHV를 그대로 쓰므로 값이 갈라질 일은 없다.
 */
function fmtShvOffline(amountDshv: number): string {
  return `${(amountDshv / DSHV_PER_SHV).toFixed(1)} SHV`;
}

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

      {/* ★이 페이지의 본론 — 검사 대행이 아니라 도구 배포. 그래서 입력창보다 위에 둔다. */}
      <section className="card checker-download">
        <h2>{v.download.title}</h2>
        <p>{v.download.body}</p>
        <div className="checker-download-actions">
          {/* download 속성 — 열지 말고 보관하게 한다("자기 기기에 보관하라"). */}
          <a className="btn" href={CHECKER_FILE_URL} download={CHECKER_FILE_NAME}>
            {v.download.cta}
          </a>
          {/* 파일명은 코드 문자열이라 RTL에서도 LTR로 고정한다 (양방향 섞임 방지). */}
          <code className="checker-file-name" dir="ltr">
            {CHECKER_FILE_NAME}
          </code>
        </div>
        <p className="muted">{v.download.offlineHint}</p>
        <p className="muted">{v.download.communityNote}</p>
        {v.download.langNote && <p className="muted">{v.download.langNote}</p>}
      </section>

      {/* 검사 강도는 각자의 손실 위험에 비례해 각자 정한다 — 우리는 강요하지 않는다. */}
      <section className="checker-effort">
        <h2>{v.effort.title}</h2>
        <p>{v.effort.body}</p>
        <ul className="checker-effort-list">
          <li>{v.effort.lowStake}</li>
          <li>{v.effort.highStake}</li>
        </ul>
      </section>

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
            {v.statsLine(report.proofCount, report.grantCount, fmtShvOffline(report.totalDshv))}
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

      {/* ★헌법 제3조 정직화 — 못 하는 것을 함께 밝힌다. 판정 바로 아래에 두는 이유는
          '모순 없음'을 진짜라는 증명으로 오해하는 일이 바로 여기서 일어나기 때문이다. */}
      <section className="checker-limits">
        <h2>{v.limits.title}</h2>
        <ul>
          {v.limits.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
