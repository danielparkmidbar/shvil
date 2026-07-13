import { en } from './en';
import { es } from './es';
import { he } from './he';
import { ko } from './ko';
import type { Locale, Strings } from './types';

/** 로케일별 사전 — 4개 언어 완비 (en 기본, he는 RTL). */
export const DICTIONARIES: Record<Locale, Strings> = { en, he, ko, es };
