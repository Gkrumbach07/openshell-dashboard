import {
  MAX_UPLOAD_BYTES,
  formatBytes,
  uploadRelativePath,
} from '../fileTransfer';

// A File with the extra properties a folder picker or a drop zone sets.
const picked = (name: string, extra: Record<string, string> = {}): File => {
  const file = new File(['x'], name);
  Object.entries(extra).forEach(([key, value]) =>
    Object.defineProperty(file, key, { value }),
  );
  return file;
};

describe('uploadRelativePath', () => {
  it.each([
    ['a file picked on its own', picked('notes.txt'), 'notes.txt'],
    [
      'a file out of a folder picked with the folder picker',
      picked('main.go', { webkitRelativePath: 'project/src/main.go' }),
      'project/src/main.go',
    ],
    [
      'a file out of a dropped folder',
      picked('main.go', { path: '/project/src/main.go' }),
      'project/src/main.go',
    ],
    [
      'a file dropped on its own',
      picked('notes.txt', { path: './notes.txt' }),
      'notes.txt',
    ],
    [
      'the folder picker over the drop zone, which copies it',
      picked('main.go', {
        webkitRelativePath: 'project/main.go',
        path: './main.go',
      }),
      'project/main.go',
    ],
    [
      'a drop zone that only sets relativePath',
      picked('main.go', { relativePath: '/project/main.go' }),
      'project/main.go',
    ],
    [
      'a path that is nothing but separators',
      picked('notes.txt', { path: './' }),
      'notes.txt',
    ],
  ])('%s', (_name, file, want) => {
    expect(uploadRelativePath(file)).toBe(want);
  });

  // The BFF is what refuses a path that could leave the destination. This
  // side must not turn such a path into one that looks harmless.
  it.each([
    ['../../etc/passwd'],
    ['project/../../etc/passwd'],
    ['..\\..\\etc\\passwd'],
  ])('passes %s on as it is', (path) => {
    expect(uploadRelativePath(picked('passwd', { path }))).toBe(path);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KiB'],
    [1536, '1.5 KiB'],
    [300 * 1024, '300 KiB'],
    [5 * 1024 * 1024, '5 MiB'],
    [MAX_UPLOAD_BYTES, '64 MiB'],
    [1.25 * 1024 * 1024 * 1024, '1.3 GiB'],
  ])('%d bytes is %s', (bytes, want) => {
    expect(formatBytes(bytes)).toBe(want);
  });
});
