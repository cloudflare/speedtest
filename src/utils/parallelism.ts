export const appendParallelism = (
  sessionId: string | undefined,
  parallelism: number | undefined
): string | undefined => {
  if (!sessionId) return sessionId;
  const fields = sessionId
    .split('&')
    .filter(field => !field.startsWith('parallel='));
  return parallelism === undefined
    ? fields.join('&')
    : [...fields, `parallel=${parallelism}`].join('&');
};
