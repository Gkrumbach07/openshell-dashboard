import {
  setApiBasePath,
  setAuthTokenGetter,
  setAuthTokenHeader,
  setSessionExpiredHandler,
} from '../client';
import { downloadFile, isUploadAborted, uploadFile } from '../sandboxes';

// What the BFF was sent, and the means to answer it.
type SentUpload = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: FormData;
  aborted: boolean;
  respond: (status: number, body: unknown) => void;
  progress: (loaded: number, total: number) => void;
  fail: () => void;
};

// An upload asks the client for its auth headers before it sends anything,
// so the request is on its way one turn after uploadFile was called.
const started = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Whatever a test configured the client with is taken back after it.
afterEach(() => {
  setApiBasePath('');
  setAuthTokenGetter(null);
  setAuthTokenHeader('Authorization');
  setSessionExpiredHandler(null);
});

// A stand-in for XMLHttpRequest that records the request and lets the test
// answer it.
const installFakeRequests = (): SentUpload[] => {
  const sent: SentUpload[] = [];
  class FakeRequest {
    status = 0;
    responseText = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
      onprogress: null,
    };
    private method = '';
    private url = '';
    private headers: Record<string, string> = {};
    private record: SentUpload | null = null;

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }

    abort() {
      if (this.record) {
        this.record.aborted = true;
      }
      this.onabort?.();
    }

    send(body: FormData) {
      this.record = {
        method: this.method,
        url: this.url,
        headers: this.headers,
        body,
        aborted: false,
        respond: (status, responseBody) => {
          this.status = status;
          this.responseText =
            typeof responseBody === 'string'
              ? responseBody
              : JSON.stringify(responseBody);
          this.onload?.();
        },
        progress: (loaded, total) =>
          this.upload.onprogress?.({
            lengthComputable: true,
            loaded,
            total,
          } as ProgressEvent),
        fail: () => this.onerror?.(),
      };
      sent.push(this.record);
    }
  }
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest =
    FakeRequest;
  return sent;
};

const file = new File(['hello'], 'hello.txt');

describe('uploadFile', () => {
  const realRequest = global.XMLHttpRequest;
  let sent: SentUpload[];

  beforeEach(() => {
    sent = installFakeRequests();
  });

  afterEach(() => {
    global.XMLHttpRequest = realRequest;
  });

  it('posts one file to the sandbox, as it always has', async () => {
    const upload = uploadFile('team a', 'my/sandbox', file);
    await started();
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('POST');
    expect(sent[0].url).toBe(
      '/api/v1/workspaces/team%20a/sandboxes/my%2Fsandbox/files',
    );
    expect([...sent[0].body.keys()]).toEqual(['file']);
    expect(sent[0].body.get('file')).toBe(file);

    const result = {
      exitCode: 0,
      path: '/sandbox/hello.txt',
      size: 5,
      stdout: '',
      success: true,
      files: [{ path: '/sandbox/hello.txt', size: 5, success: true }],
    };
    sent[0].respond(200, result);
    await expect(upload).resolves.toEqual(result);
  });

  it('names the destination directory in the query', async () => {
    void uploadFile('default', 'sb', file, '/sandbox/my dir');
    await started();
    expect(sent[0].url).toBe(
      '/api/v1/workspaces/default/sandboxes/sb/files?dest=%2Fsandbox%2Fmy%20dir',
    );
  });

  it('sends the relative path ahead of the file it belongs to', async () => {
    void uploadFile('default', 'sb', file, '/sandbox', {
      relativePath: 'project/src/hello.txt',
    });
    await started();
    // The BFF reads the upload as it arrives, so the order is the contract.
    expect([...sent[0].body.keys()]).toEqual(['relativePath', 'file']);
    expect(sent[0].body.get('relativePath')).toBe('project/src/hello.txt');
  });

  it('reports how much has been sent', async () => {
    const onProgress = jest.fn();
    void uploadFile('default', 'sb', file, undefined, { onProgress });
    await started();
    sent[0].progress(1, 4);
    sent[0].progress(4, 4);
    expect(onProgress.mock.calls).toEqual([[0.25], [1]]);
  });

  it.each([
    [
      'the reason the sandbox gave for the file',
      502,
      {
        code: 'upload_failed',
        message: 'file upload failed',
        files: [
          {
            path: '/usr/hello.txt',
            size: 0,
            success: false,
            error: 'Permission denied',
          },
        ],
      },
      'Permission denied',
    ],
    [
      'the message of a refusal that names no file',
      413,
      {
        code: 'upload_too_large',
        message:
          'upload is larger than the limit of 67108864 bytes for one request',
      },
      'upload is larger than the limit of 67108864 bytes for one request',
    ],
    [
      'the status when the answer is not JSON',
      504,
      '<html>gateway timeout</html>',
      'Upload failed (504)',
    ],
  ])('fails with %s', async (_name, status, body, message) => {
    const upload = uploadFile('default', 'sb', file);
    await started();
    sent[0].respond(status, body);
    await expect(upload).rejects.toThrow(message);
  });

  it('fails when the connection is lost', async () => {
    const upload = uploadFile('default', 'sb', file);
    await started();
    sent[0].fail();
    await expect(upload).rejects.toThrow(
      'Upload failed: the connection was lost',
    );
  });

  // The upload is a request of the configured client like any other: an
  // embedding product that moved the API, or that supplies the token itself,
  // must find its files going the same way as everything else.
  describe('through the configured client', () => {
    it('sends no auth header of its own while no token getter is set', async () => {
      void uploadFile('default', 'sb', file);
      await started();
      expect(sent[0].headers).toEqual({});
    });

    it('goes to the API under the base path', async () => {
      setApiBasePath('/openshell');
      void uploadFile('team a', 'sb', file, '/sandbox');
      await started();
      expect(sent[0].url).toBe(
        '/openshell/api/v1/workspaces/team%20a/sandboxes/sb/files?dest=%2Fsandbox',
      );
    });

    it('carries the token of the token getter, asked for before it is sent', async () => {
      const getter = jest.fn(async () => 'token-b');
      setAuthTokenGetter(getter);
      void uploadFile('default', 'sb', file);
      await started();
      expect(getter).toHaveBeenCalledTimes(1);
      expect(sent[0].headers).toEqual({ Authorization: 'Bearer token-b' });
    });

    it('puts the token on the header that was chosen for it', async () => {
      setAuthTokenGetter(() => 'token-b');
      setAuthTokenHeader('X-OpenShell-Authorization');
      void uploadFile('default', 'sb', file);
      await started();
      expect(sent[0].headers).toEqual({
        'X-OpenShell-Authorization': 'Bearer token-b',
      });
    });

    it('runs the session-expired handler once when the answer is a 401', async () => {
      const onExpired = jest.fn();
      setSessionExpiredHandler(onExpired);
      const upload = uploadFile('default', 'sb', file);
      await started();
      sent[0].respond(401, { code: 'unauthorized', message: 'no session' });
      await expect(upload).rejects.toMatchObject({
        status: 401,
        code: 'unauthorized',
        message: 'Session expired',
      });
      expect(onExpired).toHaveBeenCalledTimes(1);
    });

    it('leaves the handler alone for a failure that is not a 401', async () => {
      const onExpired = jest.fn();
      setSessionExpiredHandler(onExpired);
      const upload = uploadFile('default', 'sb', file);
      await started();
      sent[0].respond(502, { message: 'file upload failed' });
      await expect(upload).rejects.toThrow('file upload failed');
      expect(onExpired).not.toHaveBeenCalled();
    });
  });

  describe('when it is stopped', () => {
    it('aborts the request that is on its way and fails as aborted', async () => {
      const controller = new AbortController();
      const upload = uploadFile('default', 'sb', file, undefined, {
        signal: controller.signal,
      });
      await started();
      expect(sent[0].aborted).toBe(false);

      controller.abort();

      expect(sent[0].aborted).toBe(true);
      const error = await upload.catch((caught: unknown) => caught);
      expect(isUploadAborted(error)).toBe(true);
    });

    it('sends nothing when it was stopped before it started', async () => {
      const controller = new AbortController();
      controller.abort();
      const upload = uploadFile('default', 'sb', file, undefined, {
        signal: controller.signal,
      });
      const error = await upload.catch((caught: unknown) => caught);
      expect(isUploadAborted(error)).toBe(true);
      expect(sent).toHaveLength(0);
    });

    it('does not take a failure of another kind for a stop', async () => {
      const upload = uploadFile('default', 'sb', file);
      await started();
      sent[0].fail();
      const error = await upload.catch((caught: unknown) => caught);
      expect(isUploadAborted(error)).toBe(false);
    });
  });
});

describe('downloadFile', () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  let saved: { name: string; href: string }[];

  // A response as far as downloadFile looks at one.
  const answer = (
    status: number,
    contentType: string,
    body: Blob | Error | Record<string, unknown>,
  ) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name === 'Content-Type' ? contentType : null),
    },
    json: async () => body,
    blob: async () => {
      if (body instanceof Error) {
        throw body;
      }
      return body;
    },
  });

  beforeEach(() => {
    saved = [];
    fetchMock.mockReset();
    global.fetch = fetchMock;
    URL.createObjectURL = jest.fn(() => 'blob:download');
    URL.revokeObjectURL = jest.fn();
    jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function click(this: HTMLAnchorElement) {
        saved.push({ name: this.download, href: this.href });
      });
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('saves a file under its own name', async () => {
    fetchMock.mockResolvedValue(
      answer(200, 'application/octet-stream', new Blob(['hello'])),
    );
    await expect(
      downloadFile('team a', 'sb', '/sandbox/out/report.bin'),
    ).resolves.toEqual({ fileName: 'report.bin', isArchive: false, size: 5 });
    // No base path and no token getter: the path as it is, and no headers.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/workspaces/team%20a/sandboxes/sb/files?path=%2Fsandbox%2Fout%2Freport.bin',
      { headers: {} },
    );
    expect(saved).toEqual([{ name: 'report.bin', href: 'blob:download' }]);
  });

  it.each([
    ['/sandbox/project', 'project.tar'],
    ['/sandbox/project/', 'project.tar'],
    // The root has no name of its own.
    ['/', 'sb.tar'],
  ])('saves the directory %s as the archive %s', async (path, wantName) => {
    fetchMock.mockResolvedValue(
      answer(200, 'application/x-tar', new Blob(['tar-bytes'])),
    );
    await expect(downloadFile('default', 'sb', path)).resolves.toEqual({
      fileName: wantName,
      isArchive: true,
      size: 9,
    });
    expect(saved).toEqual([{ name: wantName, href: 'blob:download' }]);
  });

  it('fails with what the BFF says about a path it refused', async () => {
    fetchMock.mockResolvedValue(
      answer(404, 'application/json', {
        code: 'file_not_found',
        message: 'no such file or directory in the sandbox',
      }),
    );
    await expect(
      downloadFile('default', 'sb', '/sandbox/nope'),
    ).rejects.toThrow('no such file or directory in the sandbox');
    expect(saved).toEqual([]);
  });

  // A download is streamed, so a failure can come after the 200. It breaks
  // the connection, and what arrived until then must not be saved as if it
  // were the file.
  it('saves nothing when the transfer breaks part way', async () => {
    fetchMock.mockResolvedValue(
      answer(200, 'application/x-tar', new TypeError('network error')),
    );
    await expect(
      downloadFile('default', 'sb', '/sandbox/project'),
    ).rejects.toThrow(/part way/);
    expect(saved).toEqual([]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  describe('through the configured client', () => {
    it('asks the API under the base path, with the token of the token getter', async () => {
      setApiBasePath('/openshell');
      setAuthTokenGetter(async () => 'token-b');
      setAuthTokenHeader('X-OpenShell-Authorization');
      fetchMock.mockResolvedValue(
        answer(200, 'application/octet-stream', new Blob(['hello'])),
      );

      await downloadFile('team a', 'sb', '/sandbox/out/report.bin');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        '/openshell/api/v1/workspaces/team%20a/sandboxes/sb/files?path=%2Fsandbox%2Fout%2Freport.bin',
        { headers: { 'X-OpenShell-Authorization': 'Bearer token-b' } },
      );
    });

    it('runs the session-expired handler once when the answer is a 401, and saves nothing', async () => {
      const onExpired = jest.fn();
      setSessionExpiredHandler(onExpired);
      fetchMock.mockResolvedValue(
        answer(401, 'application/json', {
          code: 'unauthorized',
          message: 'no session',
        }),
      );

      await expect(
        downloadFile('default', 'sb', '/sandbox/file'),
      ).rejects.toMatchObject({
        status: 401,
        code: 'unauthorized',
        message: 'Session expired',
      });
      expect(onExpired).toHaveBeenCalledTimes(1);
      expect(saved).toEqual([]);
    });

    it('leaves the handler alone for a failure that is not a 401', async () => {
      const onExpired = jest.fn();
      setSessionExpiredHandler(onExpired);
      fetchMock.mockResolvedValue(
        answer(404, 'application/json', { message: 'no such file' }),
      );
      await expect(
        downloadFile('default', 'sb', '/sandbox/nope'),
      ).rejects.toThrow('no such file');
      expect(onExpired).not.toHaveBeenCalled();
    });
  });
});
