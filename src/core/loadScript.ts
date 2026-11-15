// Loads a Google script once. The Content Security Policy in index.html must allow its address.

const loading = new Map<string, Promise<void>>();

export function loadScript(src: string): Promise<void> {
  const existing = loading.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading.delete(src);
      reject(new Error(`Could not load ${src}. Check the internet connection and try again.`));
    };
    document.head.append(script);
  });
  loading.set(src, promise);
  return promise;
}
