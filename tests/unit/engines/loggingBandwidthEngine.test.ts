import { describe, expect, it } from 'vitest';

import {
  getLoggedBytes,
  parseUploadBytesHeader
} from '../../../src/engines/LoggingBandwidthEngine/index.js';

describe('LoggingBandwidthEngine', () => {
  describe('parseUploadBytesHeader', () => {
    it('reads a valid cf-meta-upload-bytes header', () => {
      const headers = new Headers({ 'cf-meta-upload-bytes': '4000000000' });

      expect(parseUploadBytesHeader(headers)).toBe(4000000000);
    });

    it('ignores missing or invalid cf-meta-upload-bytes headers', () => {
      expect(parseUploadBytesHeader(new Headers())).toBeUndefined();
      expect(
        parseUploadBytesHeader(new Headers({ 'cf-meta-upload-bytes': '1e3' }))
      ).toBeUndefined();
      expect(
        parseUploadBytesHeader(new Headers({ 'cf-meta-upload-bytes': '-1' }))
      ).toBeUndefined();
    });
  });

  describe('getLoggedBytes', () => {
    it('uses server-reported upload bytes for upload measurements', () => {
      expect(
        getLoggedBytes({ type: 'up', bytes: 5000000000 }, 4000000000)
      ).toBe(4000000000);
    });

    it('falls back to measured bytes when the header is absent', () => {
      expect(getLoggedBytes({ type: 'up', bytes: 5000000000 }, undefined)).toBe(
        5000000000
      );
    });

    it('does not override download measurements', () => {
      expect(
        getLoggedBytes({ type: 'down', bytes: 5000000000 }, 4000000000)
      ).toBe(5000000000);
    });
  });
});
