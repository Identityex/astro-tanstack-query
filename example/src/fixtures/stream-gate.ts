// The browser test controls the final HTML chunk, so a fast machine cannot skip the race.
const releases = new Map<string, () => void>();

export function holdStream(id: string): Promise<void> {
  return new Promise((resolve) => {
    releases.set(id, resolve);
  });
}

export function releaseStream(id: string): boolean {
  const release = releases.get(id);
  if (!release) return false;
  releases.delete(id);
  release();
  return true;
}
