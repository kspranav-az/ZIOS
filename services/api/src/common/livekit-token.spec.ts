import { describe, expect, it } from 'vitest';
import { issueLiveKitToken } from './livekit-token';

function decodeJwt(token: string) {
  const [, payloadB64] = token.split('.');
  return JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf8'));
}

describe('issueLiveKitToken', () => {
  it('puts identity at the JWT payload root and inside video grants', () => {
    const result = issueLiveKitToken({
      apiKey: 'devkey',
      apiSecret: 'secret',
      url: 'wss://livekit.example.com',
      roomName: 'human-session-1',
      identity: 'candidate-session-1',
      name: 'Candidate',
    });

    const payload = decodeJwt(result.token);
    expect(payload.iss).toBe('devkey');
    expect(payload.sub).toBe('candidate-session-1');
    expect(payload.identity).toBe('candidate-session-1');
    expect(payload.video).toEqual({
      roomJoin: true,
      room: 'human-session-1',
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    expect(payload.video).not.toHaveProperty('identity');
    expect(JSON.parse(payload.metadata)).toEqual({ name: 'Candidate' });
  });

  it('returns the configured URL and room name', () => {
    const result = issueLiveKitToken({
      apiKey: 'devkey',
      apiSecret: 'secret',
      url: 'wss://livekit.example.com',
      roomName: 'room-2',
      identity: 'interviewer-user-2',
    });

    expect(result.url).toBe('wss://livekit.example.com');
    expect(result.roomName).toBe('room-2');
  });
});
