import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import SandboxFilesTab from '../sandbox/SandboxFilesTab';
import { MAX_UPLOAD_BYTES } from '../../utils/fileTransfer';

jest.mock('../../api/sandboxes', () => ({
  uploadFile: jest.fn(),
  downloadFile: jest.fn(),
}));

import { downloadFile, uploadFile } from '../../api/sandboxes';
const mockUpload = uploadFile as jest.Mock;
const mockDownload = downloadFile as jest.Mock;

type UploadOptions = {
  relativePath?: string;
  onProgress?: (sent: number) => void;
  signal?: AbortSignal;
};

// One upload the tab started, and the means to finish it.
type StartedUpload = {
  file: File;
  dest?: string;
  options: UploadOptions;
  succeed: () => void;
  fail: (message: string) => void;
};

// Makes uploadFile hang until the test settles it, so that what the tab shows
// while files are on their way can be looked at.
const holdUploads = (): StartedUpload[] => {
  const started: StartedUpload[] = [];
  mockUpload.mockImplementation(
    (
      _workspace: string,
      _name: string,
      file: File,
      dest?: string,
      options: UploadOptions = {},
    ) =>
      new Promise((resolve, reject) => {
        started.push({
          file,
          dest,
          options,
          succeed: () =>
            resolve({
              exitCode: 0,
              path: `${dest}/${options.relativePath ?? file.name}`,
              size: file.size,
              stdout: '',
              success: true,
            }),
          fail: (message) => reject(new Error(message)),
        });
      }),
  );
  return started;
};

// Answers every upload at once: a failure for the paths named, a success for
// the rest.
const settleUploads = (failures: Record<string, string> = {}) =>
  mockUpload.mockImplementation(
    async (
      _workspace: string,
      _name: string,
      file: File,
      dest?: string,
      options: UploadOptions = {},
    ) => {
      const path = options.relativePath ?? file.name;
      if (failures[path]) {
        throw new Error(failures[path]);
      }
      return {
        exitCode: 0,
        path: `${dest}/${path}`,
        size: file.size,
        stdout: '',
        success: true,
      };
    },
  );

const loose = (name: string, content = 'x'): File => new File([content], name);

// A file as the browser's folder picker hands it over.
const fromFolder = (relativePath: string): File => {
  const file = loose(relativePath.split('/').pop() ?? relativePath);
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
};

const renderTab = () =>
  render(<SandboxFilesTab workspace="team-a" sandboxName="agent" />);

// Picks files with the drop zone's own file input, which is what its "Select
// files" button opens.
const pickFiles = async (files: File[]) => {
  const input = screen
    .getByTestId('file-upload-dropzone')
    .querySelector('input[type="file"]');
  if (!input) {
    throw new Error('the drop zone has no file input');
  }
  fireEvent.change(input, { target: { files } });
  await waitFor(() =>
    expect(screen.getAllByTestId('file-upload-item').length).toBeGreaterThan(0),
  );
};

const pickFolder = (files: File[]) =>
  fireEvent.change(screen.getByTestId('file-upload-folder-input'), {
    target: { files },
  });

const items = () => screen.queryAllByTestId('file-upload-item');

const itemFor = (path: string): HTMLElement => {
  const found = items().find((item) => within(item).queryByText(path));
  if (!found) {
    throw new Error(`no list entry for ${path}`);
  }
  return found;
};

const progressOf = (path: string): string | null =>
  within(itemFor(path)).getByRole('progressbar').getAttribute('aria-valuenow');

const clickUpload = () =>
  fireEvent.click(screen.getByTestId('file-upload-button'));

beforeEach(() => {
  mockUpload.mockReset();
  mockDownload.mockReset();
});

describe('SandboxFilesTab', () => {
  it('says what it cannot do', () => {
    renderTab();
    expect(screen.getByTestId('files-intro')).toHaveTextContent(
      'There is no file browser here',
    );
    const limits = screen.getByTestId('files-limits');
    fireEvent.click(within(limits).getByRole('button'));
    [
      'Uploads are not filtered',
      'Permissions, timestamps and empty folders are not kept',
      'a symbolic link is not kept as a link',
      'can be up to 64 MiB',
      'can be left incomplete in the sandbox',
      "stops when you leave the sandbox's page",
      'It is not unpacked for you',
      "held in the browser's memory",
      'any path the sandbox user can read can be downloaded',
    ].forEach((text) => expect(limits).toHaveTextContent(text));
  });

  it('has a folder picker that offers folders', () => {
    renderTab();
    const input = screen.getByTestId('file-upload-folder-input');
    expect(input).toHaveAttribute('webkitdirectory');
    expect(input).toHaveAttribute('multiple');
    const click = jest
      .spyOn(input, 'click')
      .mockImplementation(() => undefined);
    fireEvent.click(screen.getByTestId('file-upload-folder-button'));
    expect(click).toHaveBeenCalled();
  });

  it('has nothing to upload until files are picked', () => {
    renderTab();
    expect(screen.getByTestId('file-upload-button')).toBeDisabled();
    expect(screen.getByTestId('file-upload-button')).toHaveTextContent(
      /^Upload$/,
    );
    expect(items()).toHaveLength(0);
  });

  describe('uploading several files', () => {
    it('sends each file on its own, by its name, to the destination', async () => {
      settleUploads();
      renderTab();
      fireEvent.change(screen.getByTestId('file-upload-dest'), {
        target: { value: '/sandbox/in' },
      });
      await pickFiles([loose('a.txt'), loose('b.bin'), loose('c.md')]);

      expect(items()).toHaveLength(3);
      expect(screen.getByTestId('file-upload-status')).toHaveTextContent(
        '3 files to upload',
      );
      expect(screen.getByTestId('file-upload-button')).toHaveTextContent(
        'Upload 3 files',
      );
      expect(mockUpload).not.toHaveBeenCalled();

      clickUpload();
      await waitFor(() =>
        expect(screen.getByTestId('file-upload-result')).toHaveTextContent(
          'Uploaded 3 files to /sandbox/in',
        ),
      );
      expect(mockUpload).toHaveBeenCalledTimes(3);
      mockUpload.mock.calls.forEach(([workspace, name, , dest, options]) => {
        expect([workspace, name, dest]).toEqual([
          'team-a',
          'agent',
          '/sandbox/in',
        ]);
        // A file on its own is the request the tab has always sent.
        expect(options.relativePath).toBeUndefined();
      });
      expect(mockUpload.mock.calls.map(([, , file]) => file.name)).toEqual([
        'a.txt',
        'b.bin',
        'c.md',
      ]);
      expect(screen.getByTestId('file-upload-status')).toHaveTextContent(
        '3 of 3 files uploaded',
      );
      expect(itemFor('a.txt')).toHaveTextContent('/sandbox/in/a.txt');
      expect(progressOf('a.txt')).toBe('100');
      expect(screen.getByTestId('file-upload-button')).toBeDisabled();
    });

    it('shows each file on its way and how far it is', async () => {
      const started = holdUploads();
      renderTab();
      await pickFiles([loose('a.txt'), loose('b.txt')]);
      clickUpload();
      await waitFor(() => expect(started).toHaveLength(2));

      expect(screen.getByTestId('file-upload-status')).toHaveTextContent(
        'Uploading: 0 of 2 files done',
      );
      expect(screen.getByTestId('file-upload-dest')).toBeDisabled();
      expect(screen.getByTestId('file-upload-button')).toBeDisabled();

      act(() => started[0].options.onProgress?.(0.42));
      expect(progressOf('a.txt')).toBe('42');
      expect(progressOf('b.txt')).toBe('0');

      await act(async () => started[0].succeed());
      expect(screen.getByTestId('file-upload-status')).toHaveTextContent(
        'Uploading: 1 of 2 files done',
      );
      expect(progressOf('a.txt')).toBe('100');

      await act(async () => started[1].succeed());
      expect(screen.getByTestId('file-upload-status')).toHaveTextContent(
        '2 of 2 files uploaded',
      );
      expect(screen.getByTestId('file-upload-dest')).toBeEnabled();
    });

    it('keeps a few files on their way at a time, not all of them', async () => {
      const started = holdUploads();
      renderTab();
      await pickFiles(
        ['1', '2', '3', '4', '5'].map((n) => loose(`file-${n}.txt`)),
      );
      clickUpload();
      await waitFor(() => expect(started).toHaveLength(3));

      await act(async () => started[0].succeed());
      await waitFor(() => expect(started).toHaveLength(4));
      await act(async () => {
        started[1].succeed();
        started[2].succeed();
        started[3].succeed();
      });
      await waitFor(() => expect(started).toHaveLength(5));
      await act(async () => started[4].succeed());
      await waitFor(() =>
        expect(screen.getByTestId('file-upload-result')).toBeInTheDocument(),
      );
    });

    it('stops starting files when asked to, and lets those on their way finish', async () => {
      const started = holdUploads();
      renderTab();
      await pickFiles(
        ['1', '2', '3', '4', '5'].map((n) => loose(`file-${n}.txt`)),
      );
      clickUpload();
      await waitFor(() => expect(started).toHaveLength(3));

      fireEvent.click(screen.getByTestId('file-upload-stop'));
      await act(async () => started.forEach((upload) => upload.succeed()));

      expect(started).toHaveLength(3);
      expect(screen.getByTestId('file-upload-status')).toHaveTextContent(
        '3 of 5 files uploaded',
      );
      expect(screen.getByTestId('file-upload-button')).toHaveTextContent(
        'Upload 2 files',
      );
    });
  });

  describe('uploading a folder', () => {
    it('sends each file with its path in the folder', async () => {
      settleUploads();
      renderTab();
      pickFolder([
        fromFolder('project/README.md'),
        fromFolder('project/src/main.go'),
        fromFolder('project/src/deep/data.bin'),
      ]);

      expect(itemFor('project/src/deep/data.bin')).toBeInTheDocument();
      clickUpload();
      await waitFor(() =>
        expect(screen.getByTestId('file-upload-result')).toBeInTheDocument(),
      );
      expect(
        mockUpload.mock.calls.map(([, , , dest, options]) => [
          dest,
          options.relativePath,
        ]),
      ).toEqual([
        ['/sandbox', 'project/README.md'],
        ['/sandbox', 'project/src/main.go'],
        ['/sandbox', 'project/src/deep/data.bin'],
      ]);
    });

    it('takes a dropped folder the same way', async () => {
      settleUploads();
      renderTab();
      // What the drop zone makes of a folder that is dropped on it.
      const dropped = loose('main.go');
      Object.defineProperty(dropped, 'path', { value: '/project/src/main.go' });
      await pickFiles([dropped]);

      clickUpload();
      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
      expect(mockUpload.mock.calls[0][4].relativePath).toBe(
        'project/src/main.go',
      );
    });

    it('lists a folder too large to list in part and uploads all of it', async () => {
      settleUploads();
      renderTab();
      pickFolder(
        Array.from({ length: 130 }, (_, i) => fromFolder(`big/file-${i}.txt`)),
      );

      expect(items()).toHaveLength(100);
      expect(screen.getByTestId('file-upload-unlisted')).toHaveTextContent(
        'The first 100 of 130 files are listed',
      );
      clickUpload();
      await waitFor(() =>
        expect(screen.getByTestId('file-upload-result')).toHaveTextContent(
          'Uploaded 130 files',
        ),
      );
      expect(mockUpload).toHaveBeenCalledTimes(130);
    });
  });

  describe('a file that fails', () => {
    it('is marked with the reason, and the others are still uploaded', async () => {
      settleUploads({ 'project/locked.txt': 'Permission denied' });
      renderTab();
      pickFolder([
        fromFolder('project/a.txt'),
        fromFolder('project/locked.txt'),
        fromFolder('project/z.txt'),
      ]);
      clickUpload();

      const alert = await screen.findByTestId('file-upload-error');
      expect(alert).toHaveTextContent('1 file could not be uploaded');
      expect(alert).toHaveTextContent('project/locked.txt: Permission denied');
      expect(mockUpload).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId('file-upload-status')).toHaveTextContent(
        '2 of 3 files uploaded, 1 failed',
      );
      expect(itemFor('project/locked.txt')).toHaveTextContent(
        'Permission denied',
      );
      expect(progressOf('project/z.txt')).toBe('100');
      expect(
        screen.queryByTestId('file-upload-result'),
      ).not.toBeInTheDocument();
    });

    it('can be sent again without sending the rest again', async () => {
      settleUploads({ 'project/locked.txt': 'Permission denied' });
      renderTab();
      pickFolder([
        fromFolder('project/a.txt'),
        fromFolder('project/locked.txt'),
      ]);
      clickUpload();
      await screen.findByTestId('file-upload-error');
      expect(screen.getByTestId('file-upload-button')).toHaveTextContent(
        'Retry 1 file',
      );

      settleUploads();
      mockUpload.mockClear();
      clickUpload();
      await waitFor(() =>
        expect(screen.getByTestId('file-upload-result')).toHaveTextContent(
          'Uploaded 2 files',
        ),
      );
      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(mockUpload.mock.calls[0][4].relativePath).toBe(
        'project/locked.txt',
      );
      expect(screen.queryByTestId('file-upload-error')).not.toBeInTheDocument();
    });

    it('is not sent at all when it is over the size one file can be', async () => {
      settleUploads();
      renderTab();
      const huge = loose('huge.iso');
      Object.defineProperty(huge, 'size', { value: MAX_UPLOAD_BYTES + 1 });
      const atLimit = loose('at-limit.bin');
      Object.defineProperty(atLimit, 'size', { value: MAX_UPLOAD_BYTES });
      await pickFiles([huge, atLimit]);
      clickUpload();

      const alert = await screen.findByTestId('file-upload-error');
      expect(alert).toHaveTextContent(
        'huge.iso: Larger than the 64 MiB one file can be',
      );
      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(mockUpload.mock.calls[0][2]).toBe(atLimit);
    });
  });

  describe('the list', () => {
    it('drops a file that is removed from it', async () => {
      settleUploads();
      renderTab();
      await pickFiles([loose('keep.txt'), loose('drop.txt')]);
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Remove drop.txt from the list',
        }),
      );
      expect(items()).toHaveLength(1);

      clickUpload();
      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
      expect(mockUpload.mock.calls[0][2].name).toBe('keep.txt');
    });

    it('holds one entry for a path that is picked twice', async () => {
      renderTab();
      pickFolder([fromFolder('project/a.txt')]);
      pickFolder([fromFolder('project/a.txt'), fromFolder('project/b.txt')]);
      expect(items()).toHaveLength(2);
    });

    it('can be cleared', async () => {
      renderTab();
      await pickFiles([loose('a.txt')]);
      fireEvent.click(screen.getByTestId('file-upload-clear'));
      expect(items()).toHaveLength(0);
      expect(screen.getByTestId('file-upload-button')).toBeDisabled();
    });
  });

  // An upload goes on after the click that started it. What is sent has to be
  // what the list holds when a file's turn comes, not what it held at the
  // click.
  describe('the list while an upload is running', () => {
    it('does not send a file that was taken off the list while it waited', async () => {
      const started = holdUploads();
      renderTab();
      await pickFiles(
        ['a.txt', 'b.txt', 'c.txt', 'secrets.env'].map((name) => loose(name)),
      );
      clickUpload();
      await waitFor(() => expect(started).toHaveLength(3));

      // Still waiting its turn: take it off the list.
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Remove secrets.env from the list',
        }),
      );
      expect(items()).toHaveLength(3);

      await act(async () => started.forEach((upload) => upload.succeed()));

      expect(started.map((upload) => upload.file.name)).toEqual([
        'a.txt',
        'b.txt',
        'c.txt',
      ]);
      expect(screen.getByTestId('file-upload-result')).toHaveTextContent(
        'Uploaded 3 files',
      );
    });

    it('does not send the copy of a file that was picked again while it waited', async () => {
      const started = holdUploads();
      renderTab();
      const first = fromFolder('project/d.txt');
      pickFolder([
        fromFolder('project/a.txt'),
        fromFolder('project/b.txt'),
        fromFolder('project/c.txt'),
        first,
      ]);
      clickUpload();
      await waitFor(() => expect(started).toHaveLength(3));

      // The same path again, with what the file holds now.
      const again = fromFolder('project/d.txt');
      pickFolder([again]);
      expect(items()).toHaveLength(4);

      await act(async () => started.forEach((upload) => upload.succeed()));

      // The copy that was replaced is not sent; the new one waits to be.
      expect(started.map((upload) => upload.file)).not.toContain(first);
      expect(started).toHaveLength(3);
      expect(screen.getByTestId('file-upload-button')).toHaveTextContent(
        'Upload 1 file',
      );

      clickUpload();
      await waitFor(() => expect(started).toHaveLength(4));
      expect(started[3].file).toBe(again);
    });

    it('keeps a file that is on its way listed until it has arrived', async () => {
      const started = holdUploads();
      renderTab();
      await pickFiles([loose('a.txt')]);
      clickUpload();
      await waitFor(() => expect(started).toHaveLength(1));

      fireEvent.click(
        screen.getByRole('button', { name: 'Remove a.txt from the list' }),
      );

      expect(items()).toHaveLength(1);
      await act(async () => started[0].succeed());
    });
  });

  // Leaving the tab takes the list away. An upload that went on without it
  // would send the rest of a folder with nothing on screen to say so.
  describe('when the tab goes away during an upload', () => {
    it('aborts the files on their way and starts no other', async () => {
      const started = holdUploads();
      const view = renderTab();
      await pickFiles(
        ['1', '2', '3', '4', '5'].map((n) => loose(`file-${n}.txt`)),
      );
      clickUpload();
      await waitFor(() => expect(started).toHaveLength(3));
      started.forEach((upload) =>
        expect(upload.options.signal?.aborted).toBe(false),
      );

      view.unmount();

      started.forEach((upload) =>
        expect(upload.options.signal?.aborted).toBe(true),
      );
      // The requests end, as aborted ones do, and nothing takes their place.
      await act(async () =>
        started.forEach((upload) => upload.fail('The upload was stopped')),
      );
      expect(started).toHaveLength(3);
    });
  });

  describe('where the files went', () => {
    const editDest = (value: string) =>
      fireEvent.change(screen.getByTestId('file-upload-dest'), {
        target: { value },
      });

    it('is what the upload was sent to, not what the destination field says afterwards', async () => {
      settleUploads();
      renderTab();
      editDest('/sandbox/in');
      await pickFiles([loose('a.txt')]);
      clickUpload();
      await screen.findByTestId('file-upload-result');

      editDest('/tmp/elsewhere');

      expect(screen.getByTestId('file-upload-result')).toHaveTextContent(
        'Uploaded 1 file to /sandbox/in',
      );
      expect(screen.getByTestId('file-upload-result')).not.toHaveTextContent(
        '/tmp/elsewhere',
      );
    });

    it('names each directory when the files of the list went to more than one', async () => {
      settleUploads();
      renderTab();
      editDest('/sandbox/in');
      await pickFiles([loose('a.txt')]);
      clickUpload();
      await screen.findByTestId('file-upload-result');

      editDest('/sandbox/other');
      await pickFiles([loose('b.txt')]);
      await waitFor(() => expect(items()).toHaveLength(2));
      clickUpload();

      await waitFor(() =>
        expect(screen.getByTestId('file-upload-result')).toHaveTextContent(
          'Uploaded 2 files to /sandbox/in and /sandbox/other',
        ),
      );
      expect(mockUpload.mock.calls.map(([, , , dest]) => dest)).toEqual([
        '/sandbox/in',
        '/sandbox/other',
      ]);
    });

    it('is the default directory when the destination was left empty', async () => {
      settleUploads();
      renderTab();
      editDest('');
      await pickFiles([loose('a.txt')]);
      clickUpload();

      await waitFor(() =>
        expect(screen.getByTestId('file-upload-result')).toHaveTextContent(
          'Uploaded 1 file to /sandbox',
        ),
      );
      expect(mockUpload.mock.calls[0][3]).toBeUndefined();
    });
  });

  // A file over the limit fails the same way however often it is sent.
  describe('a file that can never be sent', () => {
    const hugeFile = (name = 'huge.iso') => {
      const huge = loose(name);
      Object.defineProperty(huge, 'size', { value: MAX_UPLOAD_BYTES + 1 });
      return huge;
    };

    it('says so as soon as it is picked, and offers nothing to send', async () => {
      renderTab();
      await pickFiles([hugeFile()]);

      expect(itemFor('huge.iso')).toHaveTextContent(
        'Larger than the 64 MiB one file can be',
      );
      expect(screen.getByTestId('file-upload-error')).toHaveTextContent(
        'huge.iso: Larger than the 64 MiB one file can be',
      );
      expect(screen.getByTestId('file-upload-button')).toBeDisabled();
      expect(screen.getByTestId('file-upload-button')).toHaveTextContent(
        /^Upload$/,
      );
    });

    it('is not counted among the files to upload', async () => {
      renderTab();
      await pickFiles([hugeFile(), loose('small.txt')]);

      expect(screen.getByTestId('file-upload-button')).toHaveTextContent(
        'Upload 1 file',
      );
      expect(screen.getByTestId('file-upload-status')).toHaveTextContent(
        '1 file to upload, 1 cannot be sent',
      );
    });

    it('leaves no Retry behind once the rest has been uploaded', async () => {
      settleUploads();
      renderTab();
      await pickFiles([hugeFile(), loose('small.txt')]);
      clickUpload();
      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByTestId('file-upload-status')).toHaveTextContent(
          '1 of 2 files uploaded, 1 failed',
        ),
      );

      expect(screen.getByTestId('file-upload-button')).toBeDisabled();
      expect(screen.getByTestId('file-upload-button')).not.toHaveTextContent(
        'Retry',
      );
      // It is still said, where it can be read, that the file did not go.
      expect(screen.getByTestId('file-upload-error')).toHaveTextContent(
        '1 file could not be uploaded',
      );
    });

    it('still offers Retry for a file whose upload failed and may work again', async () => {
      settleUploads({ 'small.txt': 'Permission denied' });
      renderTab();
      await pickFiles([hugeFile(), loose('small.txt')]);
      clickUpload();
      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));

      await waitFor(() =>
        expect(screen.getByTestId('file-upload-button')).toHaveTextContent(
          'Retry 1 file',
        ),
      );
      expect(screen.getByTestId('file-upload-button')).toBeEnabled();
    });
  });

  describe('downloading', () => {
    const download = (path: string) => {
      fireEvent.change(screen.getByTestId('file-download-path'), {
        target: { value: path },
      });
      fireEvent.click(screen.getByTestId('file-download-button'));
    };

    it('says a file or a directory can be downloaded, and how a directory arrives', () => {
      renderTab();
      const card = screen.getByTestId('file-download-card');
      expect(card).toHaveTextContent('Download a file or a directory');
      expect(card).toHaveTextContent(
        'a directory as a .tar archive of its contents',
      );
      expect(screen.getByTestId('file-download-button')).toBeDisabled();
    });

    it('names the file that was saved', async () => {
      mockDownload.mockResolvedValue({
        fileName: 'report.bin',
        isArchive: false,
        size: 5 * 1024 * 1024,
      });
      renderTab();
      download('/sandbox/out/report.bin');

      const result = await screen.findByTestId('file-download-result');
      expect(mockDownload).toHaveBeenCalledWith(
        'team-a',
        'agent',
        '/sandbox/out/report.bin',
      );
      expect(result).toHaveTextContent('Downloaded report.bin (5 MiB)');
      expect(result).not.toHaveTextContent('tar archive');
    });

    it('says a directory arrived as an archive and what to do with it', async () => {
      mockDownload.mockResolvedValue({
        fileName: 'project.tar',
        isArchive: true,
        size: 20480,
      });
      renderTab();
      download('/sandbox/project');

      const result = await screen.findByTestId('file-download-result');
      expect(result).toHaveTextContent('Downloaded project.tar (20 KiB)');
      expect(result).toHaveTextContent('this is a tar archive of its contents');
      expect(result).toHaveTextContent('extract it into a folder of its own');
    });

    it('shows why a download failed and claims nothing was saved', async () => {
      mockDownload.mockRejectedValue(
        new Error('the sandbox may not read this path'),
      );
      renderTab();
      download('/root/secret');

      expect(
        await screen.findByTestId('file-download-error'),
      ).toHaveTextContent('the sandbox may not read this path');
      expect(
        screen.queryByTestId('file-download-result'),
      ).not.toBeInTheDocument();
    });

    it('forgets the last result when another download starts', async () => {
      mockDownload.mockResolvedValueOnce({
        fileName: 'a.txt',
        isArchive: false,
        size: 1,
      });
      renderTab();
      download('/sandbox/a.txt');
      await screen.findByTestId('file-download-result');

      mockDownload.mockRejectedValueOnce(new Error('no such file'));
      download('/sandbox/b.txt');
      await screen.findByTestId('file-download-error');
      expect(
        screen.queryByTestId('file-download-result'),
      ).not.toBeInTheDocument();
    });
  });
});
