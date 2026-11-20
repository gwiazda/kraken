// Sign-in log for the test version only (npm run dev). Never included on the live site:
// main.ts calls it only when import.meta.env.DEV is true, and the build removes that code.

export function startDevSignInLog(subscribe: (listener: (event: string) => void) => void): void {
  const box = document.createElement('section');
  box.className = 'dev-log';
  const title = document.createElement('h2');
  title.textContent = 'Dziennik logowania (tylko wersja testowa)';
  const list = document.createElement('ol');
  box.append(title, list);
  document.body.append(box);

  const add = (event: string) => {
    const item = document.createElement('li');
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    item.textContent = `${time}  ${event}`;
    list.append(item);
  };

  subscribe(add);
  // Focus changes show when the Google window opened (Kraken loses focus) and closed (Kraken gets it back).
  window.addEventListener('blur', () => add('Strona Krakena straciła fokus (otwarto okno Google?)'));
  window.addEventListener('focus', () => add('Strona Krakena odzyskała fokus (zamknięto okno Google?)'));
}
