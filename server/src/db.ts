/**
 * 디렉토리 서버 저장소 (node:sqlite).
 *
 * 저장하는 것: 회원(전화 해시 — 원문 비저장), 엔젤 공개 프로필(본인 자발 공개),
 * E2E 암호문 봉투(평문 없음), 프로모션 발행 기록.
 * 저장하지 않는 것: 사용자 이동 궤적, 거래 내역, 잔고 — 이 서버는 거래를 모른다.
 */
import { DatabaseSync } from 'node:sqlite';

export function createDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS members (
      member_id TEXT PRIMARY KEY,
      phone_hash TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      display_name TEXT,
      device_public_key TEXT NOT NULL,
      messaging_public_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS otp (
      phone_hash TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS angels (
      member_id TEXT PRIMARY KEY REFERENCES members(member_id),
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      services_json TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1,
      conditions TEXT,
      visible INTEGER NOT NULL DEFAULT 1,
      -- 소속 트레일 지역 (150개국 확장). 현재 LIVE는 이스라엘 하나 — 기본값.
      region_id TEXT NOT NULL DEFAULT 'israel-national',
      -- M6 예약 (R-3): 엔젤이 자발 공개하는 "지금 손님을 받을 수 있는가" 수준만.
      -- 구체 날짜·캘린더는 서버에 없다 — 그것은 E2E 메시지로만 오간다.
      available INTEGER NOT NULL DEFAULT 1,
      availability_updated_at INTEGER,
      registered_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS promo_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      grant_json TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      UNIQUE(member_id, kind)
    );
    CREATE TABLE IF NOT EXISTS hosting_evidence (
      coin_id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      submitted_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_member TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_member, id);
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_member TEXT NOT NULL,
      amount_dshv INTEGER NOT NULL,
      status TEXT NOT NULL, -- OPEN | ESCROW | SETTLED | CANCELLED
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL REFERENCES listings(id),
      buyer_member TEXT NOT NULL,
      total_usdc_micro INTEGER NOT NULL,
      status TEXT NOT NULL, -- PENDING | APPROVED | REJECTED | SETTLED
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS escrows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      offer_id INTEGER UNIQUE NOT NULL REFERENCES offers(id),
      status TEXT NOT NULL, -- AWAITING_DEPOSIT | DEPOSITED | COINS_SUBMITTED | COMPLETED | REFUNDED
      deposit_ref TEXT NOT NULL,
      coins_json TEXT,
      fee_usdc_micro INTEGER NOT NULL,
      payout_address TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    -- 코스 등록부 (shvilist.org 중심 기능, 지시서 6장 3절)
    CREATE TABLE IF NOT EXISTS course_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      proposer_member TEXT NOT NULL,
      polyline_json TEXT NOT NULL,
      segments_json TEXT NOT NULL,
      status TEXT NOT NULL, -- CANDIDATE | OFFICIAL
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS completion_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      distance_m INTEGER NOT NULL,
      days INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(course_id, member_id)
    );
    -- 클레임 게시판 (누락 걸음 구제, 지시서 2.5)
    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      walked_at INTEGER NOT NULL,
      distance_m INTEGER NOT NULL,
      photos_json TEXT NOT NULL,
      status TEXT NOT NULL, -- OPEN | APPROVED
      grant_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS claim_votes (
      claim_id INTEGER NOT NULL REFERENCES claims(id),
      voter_member TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(claim_id, voter_member)
    );
    -- 완주 인증 게시판 (격려 코인, 지시서 2.6)
    CREATE TABLE IF NOT EXISTS certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      kind TEXT NOT NULL, -- FULL | SECTION
      photos_json TEXT NOT NULL,
      data_json TEXT NOT NULL,
      grant_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(member_id, course_id, kind)
    );
    -- 검증 트레커 탑 100 (지역별, 본인 동의 — 거리·총량만, 위치 없음)
    CREATE TABLE IF NOT EXISTS leaderboard (
      member_id TEXT PRIMARY KEY,
      region TEXT NOT NULL,
      display_name TEXT NOT NULL,
      total_distance_m INTEGER NOT NULL,
      total_minted_dshv INTEGER NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    -- 소명 대기 목록 (지시서 3장 5절) — 지갑들이 내려받아 수령 보류.
    -- 사유는 자연어가 아니라 코드 + 파라미터다 (@shvil/shared FlagReason):
    -- 서버는 화면 문구를 만들지 않는다. 문장은 각 클라이언트가 자기 사전에서 조립한다.
    CREATE TABLE IF NOT EXISTS flagged_members (
      member_id TEXT PRIMARY KEY,
      reason_code TEXT NOT NULL, -- DOUBLE_SPEND_SUSPECT | OVERPRODUCTION_DAILY | OVERPRODUCTION_WEEKLY | MANUAL
      params_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL, -- PENDING | CLEARED
      flagged_at INTEGER NOT NULL
    );
    -- 기회적 동기화 지문 (보안 감사 H-1, 지시서 2.3·3장 4절) — 사후 이상 탐지 통계.
    -- 좌표·경로 없음: 코인 ID·계보 요약·주소뿐 (코인에 이미 새겨진 공개 정보).
    CREATE TABLE IF NOT EXISTS coin_sightings (
      coin_id TEXT NOT NULL,
      chain_len INTEGER NOT NULL,
      owner_address TEXT NOT NULL,
      last_from_address TEXT,
      producer_member TEXT NOT NULL,
      amount_dshv INTEGER NOT NULL,
      root_kind TEXT NOT NULL,
      reporter_member TEXT NOT NULL,
      reported_at INTEGER NOT NULL,
      PRIMARY KEY (coin_id, chain_len, owner_address)
    );
    CREATE INDEX IF NOT EXISTS idx_sightings_coin ON coin_sightings(coin_id, chain_len);
    -- 걷기 증명 통계 — 회원별 일자 합산으로 초과 생성 포착 (proofHash당 1회 dedup).
    -- 이 테이블은 사후 이상 탐지 전용이다. 입력은 /sync/coins의 지문(서명 미검증)이라
    -- 신뢰 뱃지 집계에는 쓰지 않는다(조작 가능) — 탐지는 넓게(가짜 포함) 받되, 신뢰는
    -- 아래 walk_verified_credit(서명 검증된 코인만)으로만 센다 (C안 A, 검증가능신뢰_설계).
    CREATE TABLE IF NOT EXISTS walk_proof_stats (
      proof_hash TEXT PRIMARY KEY,
      producer_member TEXT NOT NULL,
      breakdown_json TEXT NOT NULL,
      total_dshv INTEGER NOT NULL,
      first_seen INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_proof_stats_member ON walk_proof_stats(producer_member);
    -- 검증된 걷기 실적 (C 신뢰 지표 — 별점 대신 사실, 검증가능신뢰_설계.md 안 A).
    -- ★서버가 verifyCoin으로 서명·계보(+운영: 무결성 증서)를 실제 검증한 걷기 코인만
    --   여기 적재된다. proofHash당 1회(분할 형제 dedup), total_dshv는 서명된 증명의
    --   일자합에서만 온다(조작 JSON은 서명이 없어 애초에 verifyCoin을 통과 못 함).
    --   생산자 본인이 아닌 회원(유통·예치)이 제출해야 적재된다(자기 코인 자기 크레딧 금지).
    --   walkTier 뱃지는 이 표만 합산한다 — 부풀림의 뿌리(미검증 자기 신고)를 원천 차단.
    CREATE TABLE IF NOT EXISTS walk_verified_credit (
      proof_hash TEXT PRIMARY KEY,
      producer_member TEXT NOT NULL,
      total_dshv INTEGER NOT NULL,
      first_verified_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_walk_credit_producer ON walk_verified_credit(producer_member);
    -- 보물 마이닝 (M9, 몸인증_보물마이닝_설계) — 서버의 역할은 수량 한정 발행의
    -- 회계뿐이다. 이동 검증은 100% 폰 로컬이며, 이 테이블 어디에도 사용자
    -- 걸음·방향·좌표 컬럼이 없다 (존 좌표는 운영자가 공개하는 지도 데이터).
    CREATE TABLE IF NOT EXISTS treasures (
      treasure_id TEXT PRIMARY KEY,
      region_id TEXT NOT NULL,
      spec_json TEXT NOT NULL,
      amount_dshv INTEGER NOT NULL,
      total_count INTEGER NOT NULL,
      issued_count INTEGER NOT NULL DEFAULT 0,
      valid_from INTEGER NOT NULL,
      valid_until INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    -- 1인 1회: (treasure_id, member_id) UNIQUE. transcript_hash는 성공 요약의
    -- 해시일 뿐 이동 원자료가 아니다 — 서버는 이것으로 이동을 복원할 수 없다.
    CREATE TABLE IF NOT EXISTS treasure_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      treasure_id TEXT NOT NULL REFERENCES treasures(treasure_id),
      member_id TEXT NOT NULL,
      transcript_hash TEXT NOT NULL,
      grant_json TEXT,
      claimed_at INTEGER NOT NULL,
      UNIQUE(treasure_id, member_id)
    );
    -- 스팟 보물 (M12, 몸인증_보물마이닝_설계 4장) — 사업자 참여 계층.
    -- 서버의 역할은 예치(소각) 검증 + 선착순 수량 한정 발행의 회계뿐이다.
    -- ★총량 보존: deposit_total_dshv는 검증된 예치(소각)로만 증가하고, 발행 슬롯
    --   수 = floor(deposit_total_dshv / per_claim_dshv)이므로 발행이 예치를 넘을 수
    --   없다. issued_count는 청구마다 1씩 증가하며 슬롯 수를 넘으면 소진(에러)이다.
    -- 무기명 베어러는 쓰지 않는다(M10 폐기): QR은 spot_id만 담고, 그랜트는 서버가
    --   인증된 회원에게만 발행한다. 스팟 위치는 사업장이라 공개(눈금화 없음).
    CREATE TABLE IF NOT EXISTS spot_treasures (
      spot_id TEXT PRIMARY KEY,
      region_id TEXT NOT NULL,
      sponsor_member TEXT NOT NULL,
      display_name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      per_claim_dshv INTEGER NOT NULL,
      deposit_total_dshv INTEGER NOT NULL DEFAULT 0,
      issued_count INTEGER NOT NULL DEFAULT 0,
      valid_from INTEGER NOT NULL,
      valid_until INTEGER NOT NULL,
      status TEXT NOT NULL, -- OPEN | CLOSED
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_spot_region ON spot_treasures(region_id, status);
    -- 예치 코인 대장 — 이중 예치 방지. coin_id(=coinFingerprint의 coinId) UNIQUE로
    -- 같은 소각 코인을 두 번 예치할 수 없다. 좌표·경로 없음(코인 ID·금액·지문뿐).
    CREATE TABLE IF NOT EXISTS spot_deposits (
      coin_id TEXT PRIMARY KEY,
      spot_id TEXT NOT NULL REFERENCES spot_treasures(spot_id),
      sponsor_member TEXT NOT NULL,
      amount_dshv INTEGER NOT NULL,
      deposited_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_spot_deposits_spot ON spot_deposits(spot_id);
    -- 청구 대장 — 1인 1회: (spot_id, member_id) UNIQUE. 스캔 지급·스탬프 공용.
    -- 이동 원자료 없음: 회원 번호와 발행 그랜트(있으면)뿐.
    CREATE TABLE IF NOT EXISTS spot_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spot_id TEXT NOT NULL REFERENCES spot_treasures(spot_id),
      member_id TEXT NOT NULL,
      grant_json TEXT,
      claimed_at INTEGER NOT NULL,
      UNIQUE(spot_id, member_id)
    );
    -- 암호화 지갑 백업 (지시서 2.3, 보안 감사 L-2) — 서버는 blob을 보관만, 내용 못 봄.
    -- 기기 주소당 최신 1개. 니모닉 파생 키로만 복호화 가능 (종단간). 복구는 회원
    -- 번호 없이 기기 키 소유 증명만으로 자기 백업을 조회한다.
    CREATE TABLE IF NOT EXISTS wallet_backups (
      device_address TEXT PRIMARY KEY,
      blob TEXT NOT NULL,
      digest TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    -- 게스트북 (M7-A, 재조정 §4-5) — 빈집 방명록의 디지털판 (헌법 제5조 감사의 화폐).
    -- 엔젤이 자기가 받은 감사 카드 중 "공개해도 됨"(작성자 동의) 것을 자발 게시한다.
    -- 서버는 원본 카드를 못 본다(E2E) → 엔젤 지갑이 makePublic 동의를 확인하고 게시하며,
    -- 서버는 엔젤 서명으로 인증된 게시 요청을 그대로 신뢰한다 (이 신뢰 모델은 guestbook.ts
    -- 주석에 명시). 저장 컬럼은 사용자 원문(닉네임·메시지·여정)뿐 — 회원 번호는 노출하지
    -- 않는다(공개 조회는 from_display_name만). card_id UNIQUE로 같은 카드 이중 게시 차단.
    CREATE TABLE IF NOT EXISTS guestbook (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      angel_member_id TEXT NOT NULL,
      card_id TEXT UNIQUE NOT NULL,
      from_display_name TEXT NOT NULL,
      template TEXT NOT NULL,
      message TEXT NOT NULL,
      journey_line TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_guestbook_angel ON guestbook(angel_member_id, created_at);
    -- 상호 별점 (M7-B, 별점_프라이버시_결정 안 B) — 게스트북과 같은 신뢰 모델.
    -- 별점은 E2E 서명 카드로 피평가자 지갑에 도착한다 (서버는 원본을 못 본다).
    -- 피평가자가 받은 별점 중 하나를 자발 게시하면 서버가 그 내용만 보관한다.
    -- ★프라이버시 핵심: subject_member_id(피평가자)만 저장하고, "평가자↔피평가자
    --  관계"를 저장하는 필드는 어디에도 없다 — 평가자는 닉네임(from_display_name)만
    --  남는다(게스트북과 동일). 서버는 "누가 누구 집에 묵었나"를 알 수 없다.
    --  from_display_name·review는 사용자 원문(번역 대상 아님, noUiStrings 예외).
    --  rating_id UNIQUE로 같은 별점 이중 게시 차단.
    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_member_id TEXT NOT NULL,
      rating_id TEXT UNIQUE NOT NULL,
      stars INTEGER NOT NULL,
      review TEXT,
      from_display_name TEXT NOT NULL,
      direction TEXT NOT NULL, -- GUEST_TO_ANGEL | ANGEL_TO_GUEST
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ratings_subject ON ratings(subject_member_id, created_at);
    -- 자발 신고 "받은 총 개수" — 공개율("N개 받음 / M개 공개") 분모.
    -- ★서버가 별점 이벤트를 카운트하면 관계망이 남으므로(안 B 위배) 카운트하지
    --  않는다. 대신 피평가자가 게시할 때 자기 로컬 수신 총수를 자발 신고한다 —
    --  이것은 "누가 평가했나"를 담지 않는 단일 숫자라 관계를 유출하지 않는다.
    --  (은폐 방어의 한계: 자발 신고라 축소 신고로 공개율을 부풀릴 여지 — 남는 위험.)
    CREATE TABLE IF NOT EXISTS rating_disclosures (
      subject_member_id TEXT PRIMARY KEY,
      received_count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    -- 동행 찾기 게시판 (M8, 재조정 §4-6) — 여정 공유 + 팀 모집.
    -- 게스트북·별점과 같은 자발 공개 모델: 게시자(author_member_id)가 자기 여정을
    -- 공개 모집한다. 화면 표시 신원은 display_name(닉네임)이며, author_member_id는
    -- E2E 1:1 접촉·웹 딥링크를 위한 연락 라우팅 핸들이다 (엔젤 디렉토리 GET /angels가
    -- memberId를 공개하는 것과 동일 — 실명·전화·이메일 같은 개인정보가 아니다).
    -- ★프라이버시 핵심: 이 테이블 어디에도 "누가 누구와 팀"이라는 확정 팀 관계를
    --  저장하는 필드가 없다 (팀원·수락된 관심 컬럼 없음). 서버가 아는 것은 게시자
    --  본인의 공개 게시글까지다 — 관심 표명·팀 조율은 전부 E2E 메시지로만 오간다.
    --  note·display_name은 사용자 원문(번역 대상 아님, noUiStrings 예외 — 이 GET은
    --  guestbook message처럼 검사 대상 엔드포인트가 아니다).
    CREATE TABLE IF NOT EXISTS companions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id TEXT UNIQUE NOT NULL,
      author_member_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      region_id TEXT NOT NULL,
      course_id TEXT,
      from_date TEXT NOT NULL,
      to_date TEXT NOT NULL,
      party_size_current INTEGER NOT NULL,
      party_size_target INTEGER NOT NULL,
      mode TEXT NOT NULL, -- WALK | BIKE
      note TEXT,
      status TEXT NOT NULL, -- OPEN | CLOSED
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_companions_region ON companions(region_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_companions_author ON companions(author_member_id, created_at);
    -- 신뢰 지표 자발 공개 (C — 검증가능신뢰_설계 §3): 완주·검증실적 뱃지는 본인이
    -- 공개를 선택해야만 노출된다. 행이 없거나 visible=0이면 서버는 집계 자체를
    -- 내보내지 않는다. 미가입 회원 번호 조회와 응답이 같아 회원 존재 오라클도 안 된다.
    CREATE TABLE IF NOT EXISTS trust_disclosures (
      member_id TEXT PRIMARY KEY,
      visible INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);
  migrateFlaggedMembers(db);
  migrateAngelsAvailability(db);
  return db;
}

/**
 * 구 스키마 이행 (M6): angels에 가능 여부 컬럼 추가.
 * 기존 엔젤은 available=1(가능)로 시작 — 갱신 시각은 본인이 처음 설정할 때 채워진다.
 */
function migrateAngelsAvailability(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(angels)').all() as unknown as { name: string }[];
  if (cols.length === 0 || cols.some((c) => c.name === 'available')) return;
  db.exec(`
    ALTER TABLE angels ADD COLUMN available INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE angels ADD COLUMN availability_updated_at INTEGER;
  `);
}

/**
 * 구 스키마 이행: flagged_members.reason(자연어) → reason_code + params_json.
 * 파일럿 전 개발 단계이므로 구 테이블은 폐기 후 재생성한다 (소명 대기 등재는
 * 동기화 지문이 다시 쌓이면 자동 재포착된다 — 보존 가치가 없는 파생 데이터).
 */
function migrateFlaggedMembers(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(flagged_members)').all() as unknown as { name: string }[];
  if (cols.length === 0 || cols.some((c) => c.name === 'reason_code')) return;
  db.exec(`
    DROP TABLE flagged_members;
    CREATE TABLE flagged_members (
      member_id TEXT PRIMARY KEY,
      reason_code TEXT NOT NULL,
      params_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      flagged_at INTEGER NOT NULL
    );
  `);
}

export function kvGet(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function kvSet(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, value);
}
