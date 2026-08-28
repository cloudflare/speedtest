export const appendParallelism = (
  sessionId: string | undefined,
  parallelism: number
): string | undefined => {
  if (!sessionId || parallelism <= 1) return sessionId;
  const fields = sessionId
    .split('&')
    .filter(field => !field.startsWith('parallel='));
  return [...fields, `parallel=${parallelism}`].join('&');
};
