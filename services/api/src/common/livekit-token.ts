import { createHmac } from 'node:crypto';

export interface LiveKitTokenPayload {
  url: string;
  token: string;
  roomName: string;
}

export interface LiveKitTokenOptions {
  apiKey: string;
  apiSecret: string;
  url: string;
  roomName: string;
  identity: string;
  name?: string;
  ttlSeconds?: number;
}

function base64Url(input: Buffer | string): string {
  const str = Buffer.isBuffer(input)
    ? input.toString('base64')
    : Buffer.from(input).toString('base64');
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function issueLiveKitToken(options: LiveKitTokenOptions): LiveKitTokenPayload {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: options.apiKey,
    sub: options.identity,
    iat: now,
    nbf: now,
    exp: now + (options.ttlSeconds ?? 3600),
    identity: options.identity,
    metadata: options.name ? JSON.stringify({ name: options.name }) : undefined,
    video: {
      roomJoin: true,
      room: options.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', options.apiSecret).update(signingInput).digest();
  const token = `${signingInput}.${base64Url(signature)}`;

  return {
    url: options.url,
    token,
    roomName: options.roomName,
  };
}
