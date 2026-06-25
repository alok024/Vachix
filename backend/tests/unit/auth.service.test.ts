/**
 * Unit tests for auth.service.ts
 *
 * Covers generateTokens() and refreshAccessToken() — the two functions with
 * security-critical logic that is cheapest to pin at the unit level:
 *   - token lifetimes and JTI embedding
 *   - refresh-token rotation (blacklist-before-issue)
 *   - grace-window replay (concurrent prefetch reuse)
 *   - reuse detection outside the grace window
 *   - grace cache not populated when blacklist write fails
 *
 * Everything below the service boundary is mocked — no DB, no Redis,
 * no network. Tests run in milliseconds.
 */

import jwt from 'jsonwebtoken';

// ── Infrastructure mocks (must precede any app import) ───────────────────────

jest.mock('../../src/infra/logger', () => ({
  logger:     { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
  authLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Typed mock shape for db methods used by auth.service
const mockDb = {
  isTokenBlacklisted: jest.fn<Promise<boolean>, [string]>(),
  blacklistToken:     jest.fn<Promise<void>,    [unknown]>(),
  getUserById:        jest.fn<Promise<unknown>,  [string]>(),
};

jest.mock('../../src/core/database/client', () => ({ db: mockDb }));

// Redis mock — returned object represents an ioredis client.
// getRedis() is called inside getGraceTokens / setGraceTokens.
const mockRedis = {
  get: jest.fn<Promise<string | null>, [string]>(),
  set: jest.fn<Promise<'OK'>,          [string, string, string, number]>(),
};

jest.mock('../../src/infra/queue/redis', () => ({
  getRedis: jest.fn(() => mockRedis),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { generateTokens, refreshAccessToken, ACCESS_TOKEN_EXPIRES_IN } from '../../src/modules/auth/auth.service';
import { AppError } from '../../src/core/utils/errors';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_USER = {
  id:             'user-123',
  email:          'test@example.com',
  plan:           'free' as const,
  name:           'Test User',
  email_verified: true,
};

function decodeUnsafe(token: string): Record<string, unknown> {
  return jwt.decode(token) as Record<string, unknown>;
}

// Sign a real refresh token so refreshAccessToken can verify it.
function mintRefreshToken(userId: string, jti: string, expiresIn = '30d'): string {
  return jwt.sign(
    { id: userId, jti, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn } as jwt.SignOptions,
  );
}

// ── generateTokens ────────────────────────────────────────────────────────────

describe('generateTokens', () => {
  it('issues an access token expiring in 30 minutes', () => {
    const { token } = generateTokens(TEST_USER);
    const payload   = decodeUnsafe(token);
    const iat       = payload.iat as number;
    const exp       = payload.exp as number;

    // Allow ±2 s for test execution time
    expect(exp - iat).toBeGreaterThanOrEqual(30 * 60 - 2);
    expect(exp - iat).toBeLessThanOrEqual(30 * 60 + 2);
  });

  it('issues a refresh token expiring in 30 days', () => {
    const { refreshToken } = generateTokens(TEST_USER);
    const payload          = decodeUnsafe(refreshToken);
    const iat              = payload.iat as number;
    const exp              = payload.exp as number;

    expect(exp - iat).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 - 2);
    expect(exp - iat).toBeLessThanOrEqual(30 * 24 * 60 * 60 + 2);
  });

  it('embeds jti in the access token', () => {
    const { token } = generateTokens(TEST_USER);
    const payload   = decodeUnsafe(token);
    expect(typeof payload.jti).toBe('string');
    expect((payload.jti as string).length).toBeGreaterThan(0);
  });

  it('embeds jti in the refresh token', () => {
    const { refreshToken } = generateTokens(TEST_USER);
    const payload          = decodeUnsafe(refreshToken);
    expect(typeof payload.jti).toBe('string');
    expect((payload.jti as string).length).toBeGreaterThan(0);
  });

  it('generates a distinct jti per call', () => {
    const a = decodeUnsafe(generateTokens(TEST_USER).token).jti;
    const b = decodeUnsafe(generateTokens(TEST_USER).token).jti;
    expect(a).not.toBe(b);
  });
});

// ── refreshAccessToken ────────────────────────────────────────────────────────

describe('refreshAccessToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: Redis available, nothing cached, blacklist empty, user found
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockDb.isTokenBlacklisted.mockResolvedValue(false);
    mockDb.blacklistToken.mockResolvedValue(undefined);
    mockDb.getUserById.mockResolvedValue(TEST_USER);
  });

  // ── happy path ──────────────────────────────────────────────────────────────

  it('blacklists the incoming JTI before issuing new tokens', async () => {
    const jti          = 'jti-rotation-test';
    const refreshToken = mintRefreshToken(TEST_USER.id, jti);

    await refreshAccessToken(refreshToken);

    expect(mockDb.blacklistToken).toHaveBeenCalledTimes(1);
    expect(mockDb.blacklistToken).toHaveBeenCalledWith(
      expect.objectContaining({ token_jti: jti, user_id: TEST_USER.id }),
    );
  });

  it('returns a new access + refresh token pair on first use', async () => {
    const refreshToken = mintRefreshToken(TEST_USER.id, 'jti-first-use');
    const tokens       = await refreshAccessToken(refreshToken);

    expect(typeof tokens.token).toBe('string');
    expect(typeof tokens.refreshToken).toBe('string');
    // The returned access token must be verifiable with the access secret
    expect(() => jwt.verify(tokens.token, process.env.JWT_SECRET!)).not.toThrow();
  });

  // ── grace window ────────────────────────────────────────────────────────────

  it('returns cached tokens within the 30 s grace window (concurrent prefetch)', async () => {
    const jti           = 'jti-grace-hit';
    const refreshToken  = mintRefreshToken(TEST_USER.id, jti);
    const cachedTokens  = { token: 'cached-access', refreshToken: 'cached-refresh' };

    // Token already blacklisted (first request already rotated it)
    mockDb.isTokenBlacklisted.mockResolvedValue(true);
    // Grace entry exists in Redis
    mockRedis.get.mockResolvedValue(JSON.stringify(cachedTokens));

    const result = await refreshAccessToken(refreshToken);

    expect(result).toEqual(cachedTokens);
    // Must NOT issue a new blacklist entry for an already-blacklisted JTI
    expect(mockDb.blacklistToken).not.toHaveBeenCalled();
  });

  // ── reuse detection ─────────────────────────────────────────────────────────

  it('throws refresh_token_reused when JTI is blacklisted and outside grace window', async () => {
    const jti          = 'jti-reuse-attack';
    const refreshToken = mintRefreshToken(TEST_USER.id, jti);

    mockDb.isTokenBlacklisted.mockResolvedValue(true);
    // No grace entry — window has passed (or this is a different device)
    mockRedis.get.mockResolvedValue(null);

    await expect(refreshAccessToken(refreshToken)).rejects.toMatchObject({
      code:       'refresh_token_reused',
      statusCode: 401,
    });
  });

  // ── grace cache integrity ───────────────────────────────────────────────────

  it('does not populate grace cache when blacklist write fails', async () => {
    const jti          = 'jti-blacklist-fail';
    const refreshToken = mintRefreshToken(TEST_USER.id, jti);

    mockDb.isTokenBlacklisted.mockResolvedValue(false);
    // Blacklist write throws a transient DB error
    mockDb.blacklistToken.mockRejectedValue(new Error('DB timeout'));

    // Should still return tokens (non-fatal path)
    const tokens = await refreshAccessToken(refreshToken);
    expect(typeof tokens.token).toBe('string');

    // Grace cache must NOT be written — JTI was never actually persisted
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  // ── invalid token cases ─────────────────────────────────────────────────────

  it('throws invalid_refresh_token on a tampered signature', async () => {
    const bad = mintRefreshToken(TEST_USER.id, 'jti-tamper') + 'x';

    await expect(refreshAccessToken(bad)).rejects.toMatchObject({
      code:       'invalid_refresh_token',
      statusCode: 401,
    });
  });

  it('throws invalid_refresh_token on an expired token', async () => {
    const expired = mintRefreshToken(TEST_USER.id, 'jti-expired', '-1s');

    await expect(refreshAccessToken(expired)).rejects.toMatchObject({
      code:       'invalid_refresh_token',
      statusCode: 401,
    });
  });

  it('throws invalid_token_type when token type is not refresh', async () => {
    // Mint a token with type: 'access' using the refresh secret
    const wrongType = jwt.sign(
      { id: TEST_USER.id, jti: 'jti-wrong-type', type: 'access' },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: '30d' } as jwt.SignOptions,
    );

    await expect(refreshAccessToken(wrongType)).rejects.toMatchObject({
      code:       'invalid_token_type',
      statusCode: 401,
    });
  });
});
