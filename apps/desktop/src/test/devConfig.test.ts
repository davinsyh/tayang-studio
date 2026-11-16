import prodRaw from '../../src-tauri/tauri.conf.json?raw';
import devRaw from '../../src-tauri/tauri.dev.conf.json?raw';

const prod = JSON.parse(prodRaw);
const dev = JSON.parse(devRaw);

// `pnpm dev:desktop` merges tauri.dev.conf.json over tauri.conf.json. A merge replaces arrays whole,
// so the dev window list is a copy of the release one: keep the two in step.
describe('dev build config', () => {
  it('uses the installed app data and single-instance identity for this personal build', () => {
    expect(dev.identifier).toBe(prod.identifier);
    expect(dev.productName).toBe(`${prod.productName} Dev`);
  });

  it('cannot replace the personal build with an upstream release', () => {
    expect(prod.plugins.updater.endpoints).toEqual([]);
  });

  it('has the same window as a release, titled Dev', () => {
    expect(dev.app.windows).toHaveLength(prod.app.windows.length);
    expect(dev.app.windows.map((w: { title: string }) => ({ ...w, title: prod.app.windows[0].title }))).toEqual(prod.app.windows);
    expect(dev.app.windows[0].title).toBe('Tayang Studio Dev');
  });
});
