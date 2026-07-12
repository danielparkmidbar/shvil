/**
 * 지갑 내 메신저 (지시서 0-4: "지갑은 동시에 메신저다").
 *
 * - 전송: sealMessage(E2E 암호화 봉투) → POST /messages. 서버는 암호문만 중계한다.
 * - 수신: GET /messages 10초 폴링 → openMessage 복호화. 서명 무효면
 *   "발신자 확인 불가" 표식을 붙여 표시한다.
 * - 평문 저장은 기기 안 SQLite(chat_messages)에서만 — 서버에 평문 없음.
 * - 오프라인 우선: 릴레이 실패는 조용히 넘어가고(수신), 전송 실패는 호출부에 알린다.
 */
import { useSyncExternalStore } from 'react';
import { openMessage, sealMessage, type MessageEnvelope } from '@shvil/shared';
import { directoryApi } from './directory';
import {
  kvGet,
  kvSet,
  loadChatMessages,
  loadChatSummaries,
  saveChatMessage,
  type ChatMessageRow,
} from './db';
import { isProvisionalMemberId } from './identity';
import { wallet } from './walletService';
import { SENDER_UNVERIFIED_PREFIX } from './chatFormat';

const PEERS_KEY = 'chatPeers.v1';
const LAST_MSG_ID_KEY = 'chat.lastRelayId.v1';
const POLL_MS = 10_000;

/** 대화 상대 — 디렉토리에서 확인한 메시징 공개키를 함께 기억한다. */
export interface ChatPeer {
  memberId: string;
  name: string;
  messagingPublicKey: string;
}

export interface ChatState {
  peers: ChatPeer[];
  /** 대화 상대별 마지막 메시지 (목록 미리보기). */
  summaries: ChatMessageRow[];
  /** 현재 열린 대화의 메시지들. */
  activePeerId: string | null;
  activeMessages: ChatMessageRow[];
}

class ChatService {
  #listeners = new Set<() => void>();
  #state: ChatState = { peers: [], summaries: [], activePeerId: null, activeMessages: [] };
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #polling = false;

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): ChatState => this.#state;

  #set(partial: Partial<ChatState>): void {
    this.#state = { ...this.#state, ...partial };
    for (const fn of this.#listeners) fn();
  }

  async #loadPeers(): Promise<ChatPeer[]> {
    const json = await kvGet(PEERS_KEY);
    return json ? (JSON.parse(json) as ChatPeer[]) : [];
  }

  async registerPeer(peer: ChatPeer): Promise<void> {
    const peers = await this.#loadPeers();
    const idx = peers.findIndex((p) => p.memberId === peer.memberId);
    if (idx >= 0) peers[idx] = { ...peers[idx]!, ...peer };
    else peers.push(peer);
    await kvSet(PEERS_KEY, JSON.stringify(peers));
    this.#set({ peers });
  }

  async refresh(): Promise<void> {
    const [peers, summaries] = await Promise.all([this.#loadPeers(), loadChatSummaries()]);
    this.#set({ peers, summaries });
    if (this.#state.activePeerId) {
      this.#set({ activeMessages: await loadChatMessages(this.#state.activePeerId) });
    }
  }

  async openConversation(peerMemberId: string): Promise<void> {
    this.#set({ activePeerId: peerMemberId, activeMessages: await loadChatMessages(peerMemberId) });
  }

  closeConversation(): void {
    this.#set({ activePeerId: null, activeMessages: [] });
  }

  /** 전송 — E2E 봉투를 만들어 릴레이에 올린다. 실패 시 throw (호출부가 알림). */
  async sendMessage(peerMemberId: string, text: string): Promise<void> {
    const peers = await this.#loadPeers();
    const peer = peers.find((p) => p.memberId === peerMemberId);
    if (!peer) throw new Error('대화 상대 정보가 없습니다');
    if (!peer.messagingPublicKey) throw new Error('상대의 메시징 공개키를 아직 모릅니다');
    const me = wallet.identity;
    if (isProvisionalMemberId(me.memberId)) {
      throw new Error('메시지를 보내려면 먼저 가입하세요 (더보기 > 가입/설정)');
    }
    const now = Date.now();
    const envelope = sealMessage({
      plaintext: text,
      fromMemberId: me.memberId,
      toMemberId: peerMemberId,
      senderMsgKeyPair: me.messagingKeyPair,
      recipientMsgPublicKey: peer.messagingPublicKey,
      deviceSigner: me.signer,
      now,
    });
    await directoryApi.postMessage(envelope); // 실패 시 throw — 평문은 저장하지 않는다
    await saveChatMessage(peerMemberId, 'OUT', text, now);
    await this.refresh();
  }

  // ── 수신 폴링 ───────────────────────────────────────────────────

  startPolling(): void {
    if (this.#pollTimer) return;
    void this.#pollOnce();
    this.#pollTimer = setInterval(() => void this.#pollOnce(), POLL_MS);
  }

  stopPolling(): void {
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }

  async #pollOnce(): Promise<void> {
    if (this.#polling) return;
    if (!wallet.getState().ready || isProvisionalMemberId(wallet.getState().memberId)) return;
    this.#polling = true;
    try {
      const sinceId = Number((await kvGet(LAST_MSG_ID_KEY)) ?? '0');
      const messages = await directoryApi.getMessages(sinceId);
      let maxId = sinceId;
      let changed = false;
      for (const { id, envelope } of messages) {
        if (id > maxId) maxId = id;
        if (await this.#ingest(envelope)) changed = true;
      }
      if (maxId !== sinceId) await kvSet(LAST_MSG_ID_KEY, String(maxId));
      if (changed) await this.refresh();
    } catch {
      // 오프라인·서버 미가동 — 다음 폴링에서 재시도. 앱 동작에는 영향 없음.
    } finally {
      this.#polling = false;
    }
  }

  /** 봉투 복호화 → 기기 내 저장. 반환: 저장 여부. */
  async #ingest(envelope: MessageEnvelope): Promise<boolean> {
    const me = wallet.identity;
    if (envelope.toMemberId !== me.memberId) return false;
    let text: string;
    try {
      const opened = openMessage(envelope, me.messagingKeyPair);
      text = opened.signatureValid ? opened.plaintext : SENDER_UNVERIFIED_PREFIX + opened.plaintext;
    } catch {
      return false; // 복호화 불가 봉투는 폐기
    }
    // 미지의 발신자도 답장할 수 있게 봉투의 메시징 공개키로 상대를 등록한다.
    const peers = await this.#loadPeers();
    const known = peers.find((p) => p.memberId === envelope.fromMemberId);
    await this.registerPeer({
      memberId: envelope.fromMemberId,
      name: known?.name ?? envelope.fromMemberId,
      messagingPublicKey: envelope.senderMsgPublicKey,
    });
    await saveChatMessage(envelope.fromMemberId, 'IN', text, envelope.sentAt);
    return true;
  }
}

export const chatService = new ChatService();

export function useChat(): ChatState {
  return useSyncExternalStore(chatService.subscribe, chatService.getState);
}
