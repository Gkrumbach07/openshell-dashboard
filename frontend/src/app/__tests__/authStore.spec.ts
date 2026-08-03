import {
  clearToken,
  getRefreshToken,
  getToken,
  hasSession,
  isDevSession,
  setDevSession,
  setRefreshToken,
  setToken,
} from '../authStore';

describe('authStore', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  describe('getToken / setToken', () => {
    it('returns null when no token is set', () => {
      expect(getToken()).toBeNull();
    });

    it('stores and retrieves a token', () => {
      setToken('abc123');
      expect(getToken()).toBe('abc123');
    });

    it('overwrites a previous token', () => {
      setToken('first');
      setToken('second');
      expect(getToken()).toBe('second');
    });
  });

  describe('getRefreshToken / setRefreshToken', () => {
    it('returns null when no refresh token is set', () => {
      expect(getRefreshToken()).toBeNull();
    });

    it('stores and retrieves a refresh token', () => {
      setRefreshToken('refresh-xyz');
      expect(getRefreshToken()).toBe('refresh-xyz');
    });
  });

  describe('clearToken', () => {
    it('removes token, refresh token, and dev mode', () => {
      setToken('tok');
      setRefreshToken('ref');
      setDevSession();
      clearToken();
      expect(getToken()).toBeNull();
      expect(getRefreshToken()).toBeNull();
      expect(isDevSession()).toBe(false);
    });
  });

  describe('isDevSession / setDevSession', () => {
    it('returns false by default', () => {
      expect(isDevSession()).toBe(false);
    });

    it('returns true after setDevSession', () => {
      setDevSession();
      expect(isDevSession()).toBe(true);
    });
  });

  describe('hasSession', () => {
    it('returns false with no token and no dev mode', () => {
      expect(hasSession()).toBe(false);
    });

    it('returns true when a token is set', () => {
      setToken('tok');
      expect(hasSession()).toBe(true);
    });

    it('returns true in dev mode even without a token', () => {
      setDevSession();
      expect(hasSession()).toBe(true);
    });
  });
});
