import { describe, it, expect } from 'vitest';

/**
 * Tests for the URL construction pattern used in BandwidthEngine and
 * LoadNetworkEngine. Both engines build URLs using the URL API:
 *
 *   const urlObj = new URL(apiUrl, window.location.origin);
 *   Object.entries(qsParams).forEach(([k, v]) => urlObj.searchParams.set(k, v));
 *   const url = urlObj.href;
 *
 * This ensures custom apiUrls with existing query strings (e.g.,
 * `?token=ABC`) are handled correctly without double-? issues.
 *
 * See: https://github.com/cloudflare/speedtest/issues/105
 */

const ORIGIN = 'https://localhost';

function buildUrl(
  apiUrl: string,
  qsParams: Record<string, string>
): string {
  const urlObj = new URL(apiUrl, ORIGIN);
  Object.entries(qsParams).forEach(([k, v]) =>
    urlObj.searchParams.set(k, v)
  );
  return urlObj.href;
}

describe('URL construction', () => {
  describe('query string handling', () => {
    it('appends params to URL without query string', () => {
      const url = buildUrl('https://speed.cloudflare.com/__down', {
        bytes: '100000'
      });
      expect(url).toBe(
        'https://speed.cloudflare.com/__down?bytes=100000'
      );
    });

    it('appends params to URL with existing query string', () => {
      const url = buildUrl('https://example.com/__down?token=ABC', {
        bytes: '100000'
      });
      expect(url).toBe(
        'https://example.com/__down?token=ABC&bytes=100000'
      );
    });

    it('preserves multiple existing params in apiUrl', () => {
      const url = buildUrl(
        'https://example.com/__down?token=ABC&region=us',
        { bytes: '100000', measId: '42' }
      );
      expect(url).toBe(
        'https://example.com/__down?token=ABC&region=us&bytes=100000&measId=42'
      );
    });

    it('handles relative apiUrl without query string', () => {
      const url = buildUrl('/__down', { bytes: '100000' });
      expect(url).toBe(`${ORIGIN}/__down?bytes=100000`);
    });

    it('handles relative apiUrl with query string', () => {
      const url = buildUrl('/__down?token=ABC', { bytes: '100000' });
      expect(url).toBe(`${ORIGIN}/__down?token=ABC&bytes=100000`);
    });

    it('handles protocol-relative URLs', () => {
      const url = buildUrl('//cdn.example.com/__down', {
        bytes: '100000'
      });
      expect(url).toBe('https://cdn.example.com/__down?bytes=100000');
    });

    it('appends multiple query params', () => {
      const url = buildUrl('https://speed.cloudflare.com/__down', {
        bytes: '100000',
        measId: '42',
        during: 'download'
      });
      expect(url).toBe(
        'https://speed.cloudflare.com/__down?bytes=100000&measId=42&during=download'
      );
    });

    it('produces valid URL with empty qsParams', () => {
      const url = buildUrl('https://speed.cloudflare.com/__down', {});
      expect(url).toBe('https://speed.cloudflare.com/__down');
    });
  });

  describe('URL encoding', () => {
    it('encodes special characters in param values', () => {
      const url = buildUrl('https://speed.cloudflare.com/__down', {
        token: 'a&b=c'
      });
      expect(url).toContain('token=a%26b%3Dc');
    });

    it('encodes spaces in param values', () => {
      const url = buildUrl('https://speed.cloudflare.com/__down', {
        name: 'hello world'
      });
      expect(url).toContain('name=hello+world');
    });
  });
});
