/**
 * 동행 찾기 서비스 — M8 (서비스 재조정 §4-6, R-6).
 *
 * 두 부분으로 나뉜다:
 *  (1) 게시글: 공개 모집이므로 서버 왕복이 있다 (게스트북·별점과 같은 자발 공개).
 *      작성·갱신·삭제·조회는 directoryApi를 통한다 (게시·수정·삭제는 게시자 서명).
 *  (2) 관심 표명: "관심 있어요"는 E2E 1:1 메시지다 (기존 messaging 재사용). 게시글의
 *      연락 핸들(authorMemberId·messagingPublicKey)로 상대를 등록하고 봉인해 보낸다 —
 *      서버는 암호문만 중계하며, 확정 팀 관계를 저장하지 않는다. 실제 조율은 이 채널.
 *
 * 오프라인 우선: 모든 서버 호출은 실패 시 throw하며 호출부(화면)가 우아하게 처리한다.
 */
import {
  serializeCompanionInterest,
  type CompanionInterestPayload,
  type CompanionPostInput,
  type CompanionUpdateInput,
} from '@shvil/shared';
import { chatService } from './chatService';
import { directoryApi } from './directory';
import type { CompanionFilter, CompanionListing } from './api';

/** 동행 게시판 열람 (공개) — 필터로 지역·상태 등을 좁힌다. */
export async function loadCompanions(filter: CompanionFilter = {}): Promise<CompanionListing[]> {
  return directoryApi.getCompanions(filter);
}

/** 내 동행 글 (게시자 관리용) — CLOSED 포함 전체. author 필터로 서버가 좁혀 준다. */
export async function loadMyCompanions(myMemberId: string): Promise<CompanionListing[]> {
  return directoryApi.getCompanions({ author: myMemberId });
}

/** 동행 모집 글 등록 (게시자 서명). 형식 위반·미가입·오프라인은 throw. */
export async function postCompanion(input: CompanionPostInput): Promise<string> {
  const { postId } = await directoryApi.createCompanion(input);
  return postId;
}

/** 게시글 상태·인원 갱신 (게시자 서명) — 모집 마감·인원 증감. */
export async function updateCompanion(postId: string, update: CompanionUpdateInput): Promise<void> {
  await directoryApi.updateCompanion(postId, update);
}

/** 모집 마감 (status=CLOSED). */
export async function closeCompanion(postId: string): Promise<void> {
  await directoryApi.updateCompanion(postId, { status: 'CLOSED' });
}

/** 모집 재개 (status=OPEN). */
export async function reopenCompanion(postId: string): Promise<void> {
  await directoryApi.updateCompanion(postId, { status: 'OPEN' });
}

/** 게시글 삭제 (게시자 서명). */
export async function deleteCompanion(postId: string): Promise<void> {
  await directoryApi.removeCompanion(postId);
}

/**
 * "관심 있어요" — 게시자에게 E2E 1:1 메시지(COMPANION_INTEREST)를 보낸다.
 * 게시글의 연락 핸들로 상대를 채팅 상대로 등록한 뒤 봉인해 전송한다 — 이후 실제
 * 팀 조율은 그 대화(E2E)에서 이어간다. 서버는 관심 내용을 못 보고 팀 관계도 모른다.
 * 형식 위반·미가입·오프라인은 throw (호출부가 알림).
 */
export async function sendInterest(
  listing: CompanionListing,
  fromDisplayName: string,
  note?: string,
): Promise<void> {
  // 연락 핸들로 상대를 등록 (미지의 게시자도 대화 상대가 된다 — 엔젤 메시지와 동일 흐름).
  await chatService.registerPeer({
    memberId: listing.authorMemberId,
    name: listing.displayName,
    messagingPublicKey: listing.messagingPublicKey,
  });
  const payload: CompanionInterestPayload = {
    kind: 'COMPANION_INTEREST',
    postId: listing.postId,
    fromDisplayName: fromDisplayName.trim(),
    ...(note && note.trim() !== '' ? { note: note.trim() } : {}),
  };
  const plaintext = serializeCompanionInterest(payload); // 형식 위반이면 여기서 throw
  await chatService.sendMessage(listing.authorMemberId, plaintext);
}
