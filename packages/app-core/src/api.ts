import * as Crypto from 'expo-crypto';
import { ERROR_MESSAGES, errorCode, RPC_PARAMS, type ErrorCode, type RpcName } from '@amruta/shared';
import { getSupabase } from './supabase';

/** Error with one of our codes; `message` is always safe to show. */
export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, readonly cause?: unknown) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
  }
}

export function toAppError(e: unknown): AppError {
  return e instanceof AppError ? e : new AppError(errorCode(e), e);
}

/**
 * Call a database function. Arguments must match the API contract exactly
 * (same check as supabase/tests/11-api-contract.test.mjs), so a typo fails loudly.
 */
export async function rpc<T>(name: RpcName, args: Record<string, unknown>): Promise<T> {
  const expected = RPC_PARAMS[name] as readonly string[];
  const given = Object.keys(args);
  if (given.length !== expected.length || given.some((k) => !expected.includes(k))) {
    throw new Error(`RPC ${name}: expected params ${expected.join(', ')} but got ${given.join(', ')}`);
  }
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw new AppError(errorCode(error), error);
  return data as T;
}

/** Await a Supabase query builder and unwrap { data, error }. */
export async function run<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new AppError(errorCode(error), error);
  return data as T;
}

/** Fresh key per user action so a double tap / retry never records money twice. */
export function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}
