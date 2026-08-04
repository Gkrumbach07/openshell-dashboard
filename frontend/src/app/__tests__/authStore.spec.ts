import { clearDevSession, isDevSession, setDevSession } from '../authStore';

describe('authStore', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
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

  describe('clearDevSession', () => {
    it('removes dev mode flag', () => {
      setDevSession();
      clearDevSession();
      expect(isDevSession()).toBe(false);
    });
  });
});
