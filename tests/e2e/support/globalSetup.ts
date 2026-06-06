import { startMockServer, type MockServer } from './mockServer';
import type { GlobalSetupContext } from 'vitest/node';

declare module 'vitest' {
  interface ProvidedContext {
    mockBaseUrl: string;
  }
}

let mock: MockServer | undefined;

export default async function setup({ provide }: GlobalSetupContext) {
  mock = await startMockServer();
  provide('mockBaseUrl', mock.url);

  return async () => {
    await mock?.close();
  };
}
