import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Client } from 'minio';

@Injectable()
export class StorageClient {
  private readonly client: Client;
  private readonly bucket: string;
  private readonly encryptionKey: Buffer;

  constructor() {
    const endpoint = process.env.MINIO_ENDPOINT ?? 'localhost:9000';
    const [host, portStr] = endpoint.split(':') as [string, string | undefined];
    const port = Number(portStr ?? '9000');
    const useSSL = (process.env.MINIO_SECURE ?? 'false').toLowerCase() === 'true';
    this.client = new Client({
      endPoint: host,
      port,
      useSSL,
      accessKey: process.env.MINIO_ROOT_USER ?? 'minioadmin',
      secretKey: process.env.MINIO_ROOT_PASSWORD ?? 'minioadmin',
    });
    this.bucket = process.env.MINIO_BUCKET_MEDIA ?? 'media';
    // Field-level encryption key for ID uploads. In production this is injected
    // from a KMS/secrets manager and never committed.
    const keyHex =
      process.env.ID_UPLOAD_ENCRYPTION_KEY ??
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    this.encryptionKey = Buffer.from(keyHex, 'hex');
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }

  sha256(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  private encrypt(data: Buffer): Buffer {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    return Buffer.concat([iv, cipher.update(data), cipher.final()]);
  }

  async uploadEncrypted(path: string, data: Buffer): Promise<string> {
    await this.ensureBucket();
    const encrypted = this.encrypt(data);
    const objectName = `${path}/${this.sha256(data)}.enc`;
    await this.client.putObject(this.bucket, objectName, encrypted, encrypted.length);
    return `s3://${this.bucket}/${objectName}`;
  }

  async uploadRecording(path: string, data: Buffer): Promise<{ uri: string; checksum: string }> {
    await this.ensureBucket();
    const checksum = this.sha256(data);
    const objectName = `${path}/${checksum}.webm`;
    await this.client.putObject(this.bucket, objectName, data, data.length, {
      'Content-Type': 'video/webm',
    });
    const url = await this.client.presignedGetObject(this.bucket, objectName, 24 * 60 * 60);
    return { uri: url, checksum };
  }
}
