import { describe, it, expect } from 'vitest';
import { cfGetServerTime } from '../../../src/engines/BandwidthEngine/BandwidthEngine';

const mockResponse = (serverTiming: string) =>
  new Response('', { headers: { 'server-timing': serverTiming } });

describe('cfGetServerTime', () => {
  it('prefers cfReqDur over cfSpeed*', () => {
    const r = mockResponse(
      'cfSpeedEdge;dur=10, cfSpeedWorker;dur=20, cfReqDur;dur=45.5'
    );
    expect(cfGetServerTime(r)).toBe(45.5);
  });

  it('sums cfSpeed* entries when cfReqDur is absent', () => {
    const r = mockResponse('cfSpeedEdge;dur=10, cfSpeedWorker;dur=20');
    expect(cfGetServerTime(r)).toBe(30);
  });

  it('returns undefined when no relevant metrics', () => {
    const r = mockResponse('cfL4;desc="?proto=TCP&rtt=0"');
    expect(cfGetServerTime(r)).toBeUndefined();
  });
});
